import io
import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles

from app.config import settings
from app.db.models import Contact, OutreachEvent
from app.db.session import SessionLocal, init_db
from app.services.ai_writer import AIWriter
from app.services.gmail_service import GmailService
from app.services.outreach import (
    add_contacts,
    approve_draft,
    complete_followup,
    dashboard_stats,
    get_contacts,
    get_drafts,
    get_followups,
    mark_sent,
    record_failed,
    save_draft,
    sent_today_count,
    set_contact_status,
    sync_replies_best_effort,
    update_draft,
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="JobReach AI", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"],
)
_send_lock = threading.Lock()
_sent_this_run = 0
_all_statuses = {
    "PENDING", "DRAFTED", "SENT", "REPLIED", "FAILED",
    "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED",
}


class ContactStatusUpdate(BaseModel):
    status: Literal["PENDING", "REPLIED", "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED"]


class CompanyContextUpdate(BaseModel):
    company_context: str = Field(max_length=20_000)


class DraftInput(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=50_000)


class SendConfirmation(BaseModel):
    reviewed: bool
    typed_recipient: str


def _iso(value):
    return value.isoformat() if value else None


def _contact_dict(contact):
    return {
        "id": contact.id,
        "company_name": contact.company_name,
        "email": contact.email,
        "hr_name": contact.hr_name,
        "role": contact.role,
        "company_context": contact.company_context,
        "job_url": contact.job_url,
        "source_url": contact.source_url,
        "location": contact.location,
        "notes": contact.notes,
        "status": contact.status,
        "opted_out": contact.opted_out,
        "created_at": _iso(contact.created_at),
        "updated_at": _iso(contact.updated_at),
    }


def _draft_dict(draft):
    return {
        "id": draft.id,
        "contact_id": draft.contact_id,
        "subject": draft.subject,
        "body": draft.body,
        "status": draft.status,
        "approved_at": _iso(draft.approved_at),
        "created_at": _iso(draft.created_at),
        "contact": _contact_dict(draft.contact),
    }


def _followup_dict(event):
    return {
        "id": event.id,
        "event_type": event.event_type,
        "occurred_at": _iso(event.occurred_at),
        "followup_due_at": _iso(event.followup_due_at),
        "completed": event.completed,
        "contact": _contact_dict(event.contact),
    }


def _resume_path():
    candidates = sorted(settings.path("resumes").glob("*.pdf"))
    return candidates[0] if candidates else None


def _latest_send_at():
    with SessionLocal() as db:
        event = db.scalar(
            select(OutreachEvent)
            .where(OutreachEvent.event_type == "SENT")
            .order_by(OutreachEvent.occurred_at.desc())
            .limit(1)
        )
        if not event:
            return None
        occurred_at = event.occurred_at
        return occurred_at.replace(tzinfo=timezone.utc) if occurred_at.tzinfo is None else occurred_at


def _send_block_reason(draft, confirmation, sent_today, sent_this_run, last_sent_at, now):
    if settings.dry_run:
        return "Dry-run is enabled. Sending is disabled."
    if draft.status != "APPROVED":
        return "Only approved drafts can be sent."
    if draft.contact.opted_out or draft.contact.status in {
        "SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED",
    }:
        return "This contact is no longer eligible for outreach."
    if not confirmation.reviewed or confirmation.typed_recipient != draft.contact.email:
        return "Review the email and type the exact recipient address to confirm."
    if sent_today >= settings.max_emails_per_day:
        return "Daily sending cap reached."
    if sent_this_run >= settings.max_emails_per_run:
        return "Per-run sending cap reached. Restart the API later to begin a new run."
    if last_sent_at and (now - last_sent_at).total_seconds() < settings.min_seconds_between_emails:
        return f"Wait at least {settings.min_seconds_between_emails} seconds between sends."
    return None


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard():
    return {
        "stats": dashboard_stats(),
        "sent_today": sent_today_count(),
        "daily_cap": settings.max_emails_per_day,
        "run_cap": settings.max_emails_per_run,
        "dry_run": settings.dry_run,
        "recent_contacts": [_contact_dict(contact) for contact in get_contacts()[:15]],
    }


@app.get("/api/contacts")
def contacts(status: str = "All"):
    if status != "All" and status not in _all_statuses:
        raise HTTPException(status_code=400, detail="Invalid contact status filter.")
    return [_contact_dict(contact) for contact in get_contacts(status)]


@app.get("/api/companies/template")
def companies_template():
    return FileResponse(
        settings.path("data/companies_template.csv"),
        media_type="text/csv",
        filename="companies_template.csv",
    )


@app.post("/api/contacts/import")
async def import_contacts(file: UploadFile = File(...)):
    filename = (file.filename or "").lower()
    if not filename.endswith((".csv", ".xlsx")):
        raise HTTPException(status_code=400, detail="Upload a CSV or XLSX file.")
    content = await file.read(10_000_001)
    if len(content) > 10_000_000:
        raise HTTPException(status_code=413, detail="Import files must be 10 MB or smaller.")
    try:
        frame = pd.read_csv(io.BytesIO(content)) if filename.endswith(".csv") else pd.read_excel(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read import file: {exc}") from exc
    frame.columns = [str(column).strip().lower() for column in frame.columns]
    if not {"company_name", "email"}.issubset(frame.columns):
        raise HTTPException(status_code=400, detail="Required columns: company_name and email.")
    records = frame.fillna("").to_dict(orient="records")
    added, skipped, errors = add_contacts(records)
    return {"added": added, "skipped": skipped, "errors": errors[:10]}


@app.put("/api/contacts/{contact_id}/status")
def update_contact_status(contact_id: int, payload: ContactStatusUpdate):
    try:
        set_contact_status(contact_id, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.put("/api/contacts/{contact_id}/context")
def update_contact_context(contact_id: int, payload: CompanyContextUpdate):
    with SessionLocal() as db:
        contact = db.get(Contact, contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found.")
        contact.company_context = payload.company_context
        db.commit()
        db.refresh(contact)
        return _contact_dict(contact)


@app.post("/api/contacts/{contact_id}/generate")
def generate_draft(contact_id: int, payload: CompanyContextUpdate):
    with SessionLocal() as db:
        contact = db.get(Contact, contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found.")
        if contact.opted_out or contact.status in {"SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}:
            raise HTTPException(status_code=409, detail="This contact is not eligible for a new draft.")
        contact.company_context = payload.company_context
        db.commit()
        try:
            resume = _resume_path()
            generated = AIWriter().generate(contact, resume.name if resume else "resume.pdf")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AI generation failed: {exc}") from exc
    return generated


@app.post("/api/contacts/{contact_id}/drafts")
def create_draft(contact_id: int, payload: DraftInput):
    try:
        draft_id = save_draft(contact_id, payload.subject, payload.body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": draft_id}


@app.get("/api/drafts")
def drafts():
    return [_draft_dict(draft) for draft in get_drafts()]


@app.put("/api/drafts/{draft_id}")
def edit_draft(draft_id: int, payload: DraftInput):
    try:
        update_draft(draft_id, payload.subject, payload.body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/approve")
def approve_email_draft(draft_id: int):
    try:
        approve_draft(draft_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/drafts/{draft_id}/preview")
def preview_draft(draft_id: int):
    draft = next((item for item in get_drafts() if item.id == draft_id), None)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found.")
    if draft.status != "APPROVED":
        raise HTTPException(status_code=409, detail="Approve this draft before previewing a send.")
    return {
        "to": draft.contact.email,
        "company": draft.contact.company_name,
        "subject": draft.subject,
        "body": draft.body,
        "resume": _resume_path().name if _resume_path() else None,
    }


@app.post("/api/drafts/{draft_id}/send")
def send_draft(draft_id: int, confirmation: SendConfirmation):
    global _sent_this_run
    with _send_lock:
        draft = next((item for item in get_drafts() if item.id == draft_id), None)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found.")
        now = datetime.now(timezone.utc)
        reason = _send_block_reason(
            draft, confirmation, sent_today_count(), _sent_this_run, _latest_send_at(), now,
        )
        if reason:
            raise HTTPException(status_code=409, detail=reason)
        resume = _resume_path()
        if not resume:
            raise HTTPException(status_code=409, detail="Upload a PDF resume in Settings before sending.")
        try:
            response = GmailService().connect().send(
                draft.contact.email, draft.subject, draft.body, resume,
            )
            mark_sent(draft.id, response.get("id", ""), response.get("threadId", ""))
            _sent_this_run += 1
        except Exception as exc:
            record_failed(draft.id, exc)
            raise HTTPException(
                status_code=502,
                detail=f"Send failed or returned an uncertain result: {exc}. Check Gmail Sent before retrying.",
            ) from exc
    return {"ok": True, "message": "Gmail accepted the message send request."}


@app.get("/api/followups")
def followups():
    return [_followup_dict(event) for event in get_followups()]


@app.post("/api/followups/{event_id}/complete")
def review_followup(event_id: int):
    try:
        complete_followup(event_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/replies/sync")
def sync_replies():
    try:
        count = sync_replies_best_effort(GmailService().connect())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Reply sync failed: {exc}") from exc
    return {"updated": count}


@app.get("/api/settings")
def get_settings():
    resume = _resume_path()
    return {
        "app_name": settings.app_name,
        "sender_name": settings.sender_name,
        "sender_email": settings.sender_email,
        "profile_summary": settings.profile_summary,
        "skills": settings.skills,
        "ai_provider": settings.ai_provider,
        "ai_model": settings.ai_model,
        "ai_base_url": settings.ai_base_url,
        "dry_run": settings.dry_run,
        "max_emails_per_run": settings.max_emails_per_run,
        "max_emails_per_day": settings.max_emails_per_day,
        "min_seconds_between_emails": settings.min_seconds_between_emails,
        "resume_name": resume.name if resume else None,
    }


@app.post("/api/settings/resume")
async def upload_resume(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name
    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Upload a PDF resume.")
    content = await file.read(10_000_001)
    if len(content) > 10_000_000:
        raise HTTPException(status_code=413, detail="Resume files must be 10 MB or smaller.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF.")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._")
    if not safe_name:
        raise HTTPException(status_code=400, detail="Choose a valid resume filename.")
    resume_dir = settings.path("resumes")
    resume_dir.mkdir(parents=True, exist_ok=True)
    destination = resume_dir / safe_name
    destination.write_bytes(content)
    return {"resume_name": destination.name}


@app.post("/api/settings/gmail")
def connect_gmail():
    try:
        GmailService().connect()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gmail connection failed: {exc}") from exc
    return {"ok": True}


@app.post("/api/settings/test-ai")
def test_ai():
    try:
        result = AIWriter().client.chat.completions.create(
            model=settings.ai_model,
            messages=[{"role": "user", "content": "Reply with the word READY."}],
            max_tokens=10,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI connection failed: {exc}") from exc
    return {"response": result.choices[0].message.content or ""}


web_dist = Path(__file__).resolve().parent / "frontend" / "dist"
if web_dist.is_dir():
    app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
