import io
import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles

from app.config import settings
from app.db.models import Contact, OutreachEvent, User
from app.db.session import SessionLocal, init_db
from app.services import auth as auth_service
from app.services.ai_writer import AIWriter
from app.services.security import SESSION_MAX_AGE, make_session, read_session
from app.services.gmail_service import GmailService
from app.services.job_discovery import discover_jobs
from app.services.job_matcher import match_job
from app.services.outreach import (
    add_contacts,
    approve_draft,
    complete_followup,
    dashboard_stats,
    get_contact,
    get_contacts,
    get_drafts,
    get_followups,
    get_job,
    get_jobs,
    mark_sent,
    record_failed,
    save_draft,
    save_jobs,
    sent_today_count,
    set_contact_status,
    sync_replies_best_effort,
    update_contact_website,
    update_draft,
    update_job_match,
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


class WebsiteUpdate(BaseModel):
    website: str = Field(max_length=500)


class DraftInput(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=50_000)


class SendConfirmation(BaseModel):
    reviewed: bool
    typed_recipient: str


class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    email: str = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=128)


class TokenInput(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class EmailInput(BaseModel):
    email: str = Field(max_length=320)


class ResetPasswordInput(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=128)


def _iso(value):
    return value.isoformat() if value else None


def _user_dict(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "is_verified": user.is_verified,
        "last_login_at": _iso(user.last_login_at),
        "created_at": _iso(user.created_at),
    }


def get_session_user(session: str | None = Cookie(default=None, alias="jr_session")) -> User:
    user_id = read_session(session) if session else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    user = auth_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return user


def get_current_user(user: User = Depends(get_session_user)) -> User:
    if not user.is_verified:
        raise HTTPException(status_code=403, detail="Verify your email to continue.")
    return user


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
        "website": getattr(contact, "website", ""),
        "status": contact.status,
        "opted_out": contact.opted_out,
        "created_at": _iso(contact.created_at),
        "updated_at": _iso(contact.updated_at),
    }


def _job_dict(job):
    if not job:
        return None
    return {
        "id": job.id,
        "contact_id": job.contact_id,
        "company_name": job.company_name,
        "title": job.title,
        "location": job.location,
        "description": job.description,
        "url": job.url,
        "apply_url": job.apply_url,
        "source": job.source,
        "source_url": job.source_url,
        "active": job.active,
        "evidence": job.evidence,
        "match_score": job.match_score,
        "match_reasons": job.match_reasons,
        "verified_at": _iso(job.verified_at),
        "created_at": _iso(job.created_at),
    }


def _draft_dict(draft):
    job_id = getattr(draft, "job_id", None)
    return {
        "id": draft.id,
        "contact_id": draft.contact_id,
        "subject": draft.subject,
        "body": draft.body,
        "status": draft.status,
        "approved_at": _iso(draft.approved_at),
        "created_at": _iso(draft.created_at),
        "job_id": job_id,
        "job": _job_dict(get_job(job_id, draft.owner_id)) if job_id else None,
        "contact": _contact_dict(draft.contact),
    }


def _get_owned_draft(draft_id, owner_id):
    draft = next((item for item in get_drafts(owner_id=owner_id) if item.id == int(draft_id)), None)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return draft


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


def _latest_send_at(owner_id=None):
    with SessionLocal() as db:
        stmt = select(OutreachEvent).where(OutreachEvent.event_type == "SENT")
        if owner_id is not None:
            stmt = stmt.where(OutreachEvent.owner_id == int(owner_id))
        event = db.scalar(stmt.order_by(OutreachEvent.occurred_at.desc()).limit(1))
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


@app.post("/api/auth/register")
def register(payload: RegisterInput):
    try:
        user, token, sent = auth_service.register(payload.name, payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = {
        "message": "Account created. Verify your email to sign in.",
        "email": user.email,
        "email_sent": sent,
    }
    if not sent and settings.auth_dev_tokens:
        result["dev_verification_token"] = token
    return result


@app.post("/api/auth/verify-email")
def verify_email(payload: TokenInput):
    try:
        auth_service.verify_email(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "Email verified. You can sign in now."}


@app.post("/api/auth/resend-verification")
def resend_verification(payload: EmailInput):
    _user, token, sent = auth_service.resend_verification(payload.email)
    result = {"message": "If the account exists and is unverified, a new link has been sent."}
    if token and not sent and settings.auth_dev_tokens:
        result["dev_verification_token"] = token
    return result


@app.post("/api/auth/login")
def login(payload: LoginInput, response: Response):
    try:
        user = auth_service.authenticate(payload.email, payload.password)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    response.set_cookie(
        "jr_session", make_session(user.id), max_age=SESSION_MAX_AGE,
        httponly=True, samesite="lax", secure=settings.auth_cookie_secure, path="/",
    )
    return _user_dict(user)


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("jr_session", path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: User = Depends(get_session_user)):
    return _user_dict(user)


@app.post("/api/auth/reset-request")
def reset_request(payload: EmailInput):
    _user, token, sent = auth_service.request_reset(payload.email)
    result = {"message": "If the account exists, a reset link has been sent."}
    if token and not sent and settings.auth_dev_tokens:
        result["dev_reset_token"] = token
    return result


@app.post("/api/auth/reset-confirm")
def reset_confirm(payload: ResetPasswordInput):
    try:
        auth_service.reset_password(payload.token, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "Password updated. Sign in with your new password."}


@app.get("/api/dashboard")
def dashboard(user: User = Depends(get_current_user)):
    return {
        "stats": dashboard_stats(user.id),
        "sent_today": sent_today_count(user.id),
        "daily_cap": settings.max_emails_per_day,
        "run_cap": settings.max_emails_per_run,
        "dry_run": settings.dry_run,
        "recent_contacts": [_contact_dict(contact) for contact in get_contacts(owner_id=user.id)[:15]],
    }


@app.get("/api/contacts")
def contacts(status: str = "All", user: User = Depends(get_current_user)):
    if status != "All" and status not in _all_statuses:
        raise HTTPException(status_code=400, detail="Invalid contact status filter.")
    return [_contact_dict(contact) for contact in get_contacts(status, user.id)]


@app.get("/api/companies/template")
def companies_template(user: User = Depends(get_current_user)):
    return FileResponse(
        settings.path("data/companies_template.csv"),
        media_type="text/csv",
        filename="companies_template.csv",
    )


@app.post("/api/contacts/import")
async def import_contacts(file: UploadFile = File(...), user: User = Depends(get_current_user)):
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
    added, skipped, errors = add_contacts(records, user.id)
    return {"added": added, "skipped": skipped, "errors": errors[:10]}


@app.put("/api/contacts/{contact_id}/status")
def update_contact_status(contact_id: int, payload: ContactStatusUpdate, user: User = Depends(get_current_user)):
    try:
        set_contact_status(contact_id, payload.status, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.put("/api/contacts/{contact_id}/context")
def update_contact_context(contact_id: int, payload: CompanyContextUpdate, user: User = Depends(get_current_user)):
    with SessionLocal() as db:
        contact = db.get(Contact, contact_id)
        if not contact or contact.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Contact not found.")
        contact.company_context = payload.company_context
        db.commit()
        db.refresh(contact)
        return _contact_dict(contact)


@app.put("/api/contacts/{contact_id}/website")
def update_website(contact_id: int, payload: WebsiteUpdate, user: User = Depends(get_current_user)):
    try:
        contact = update_contact_website(contact_id, payload.website, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _contact_dict(contact)


@app.post("/api/contacts/{contact_id}/jobs/discover")
def discover_contact_jobs(contact_id: int, user: User = Depends(get_current_user)):
    with SessionLocal() as db:
        contact = db.get(Contact, contact_id)
    if not contact or contact.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Contact not found.")
    jobs, warnings = discover_jobs(contact)
    added, _skipped = save_jobs(contact.id, jobs, user.id)
    return {
        "added": added,
        "warnings": warnings[:8],
        "jobs": [_job_dict(item) for item in get_jobs(contact.id, user.id)],
    }


@app.get("/api/contacts/{contact_id}/jobs")
def list_contact_jobs(contact_id: int, user: User = Depends(get_current_user)):
    if not get_contact(contact_id, user.id):
        raise HTTPException(status_code=404, detail="Contact not found.")
    return [_job_dict(item) for item in get_jobs(contact_id, user.id)]


@app.post("/api/jobs/{job_id}/match")
def score_job(job_id: int, user: User = Depends(get_current_user)):
    job = get_job(job_id, user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    result = match_job(job)
    update_job_match(job_id, result["score"], "; ".join(result["reasons"]), user.id)
    return {"job": _job_dict(get_job(job_id, user.id)), **result}


@app.post("/api/jobs/{job_id}/generate")
def generate_job_draft(job_id: int, user: User = Depends(get_current_user)):
    job = get_job(job_id, user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    with SessionLocal() as db:
        contact = db.get(Contact, job.contact_id)
    if not contact or contact.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Contact not found.")
    if contact.opted_out or contact.status in {"SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}:
        raise HTTPException(status_code=409, detail="This contact is not eligible for a new draft.")
    match = match_job(job)
    if job.match_score is not None:
        match["score"] = job.match_score
    resume = _resume_path()
    try:
        generated = AIWriter().generate_for_job(contact, job, match, resume.name if resume else "resume.pdf")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {exc}") from exc
    draft_id = save_draft(contact.id, generated["subject"], generated["body"], job.id, user.id)
    return {"id": draft_id, **generated, "job": _job_dict(job)}


@app.post("/api/jobs/{job_id}/drafts")
def create_job_draft(job_id: int, payload: DraftInput, user: User = Depends(get_current_user)):
    job = get_job(job_id, user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    draft_id = save_draft(job.contact_id, payload.subject, payload.body, job.id, user.id)
    return {"id": draft_id}


@app.post("/api/contacts/{contact_id}/generate")
def generate_draft(contact_id: int, payload: CompanyContextUpdate, user: User = Depends(get_current_user)):
    with SessionLocal() as db:
        contact = db.get(Contact, contact_id)
        if not contact or contact.owner_id != user.id:
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
def create_draft(contact_id: int, payload: DraftInput, user: User = Depends(get_current_user)):
    try:
        draft_id = save_draft(contact_id, payload.subject, payload.body, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": draft_id}


@app.get("/api/drafts")
def drafts(user: User = Depends(get_current_user)):
    return [_draft_dict(draft) for draft in get_drafts(owner_id=user.id)]


@app.put("/api/drafts/{draft_id}")
def edit_draft(draft_id: int, payload: DraftInput, user: User = Depends(get_current_user)):
    _get_owned_draft(draft_id, user.id)
    try:
        update_draft(draft_id, payload.subject, payload.body, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/approve")
def approve_email_draft(draft_id: int, user: User = Depends(get_current_user)):
    _get_owned_draft(draft_id, user.id)
    try:
        approve_draft(draft_id, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/drafts/{draft_id}/preview")
def preview_draft(draft_id: int, user: User = Depends(get_current_user)):
    draft = _get_owned_draft(draft_id, user.id)
    if draft.status != "APPROVED":
        raise HTTPException(status_code=409, detail="Approve this draft before previewing a send.")
    job = _job_dict(get_job(draft.job_id, user.id)) if getattr(draft, "job_id", None) else None
    return {
        "to": draft.contact.email,
        "company": draft.contact.company_name,
        "subject": draft.subject,
        "body": draft.body,
        "resume": _resume_path().name if _resume_path() else None,
        "job": job,
    }


@app.post("/api/drafts/{draft_id}/send")
def send_draft(draft_id: int, confirmation: SendConfirmation, user: User = Depends(get_current_user)):
    global _sent_this_run
    with _send_lock:
        draft = _get_owned_draft(draft_id, user.id)
        now = datetime.now(timezone.utc)
        reason = _send_block_reason(
            draft, confirmation, sent_today_count(user.id), _sent_this_run,
            _latest_send_at(user.id), now,
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
            mark_sent(draft.id, response.get("id", ""), response.get("threadId", ""), owner_id=user.id)
            _sent_this_run += 1
        except Exception as exc:
            record_failed(draft.id, exc, user.id)
            raise HTTPException(
                status_code=502,
                detail=f"Send failed or returned an uncertain result: {exc}. Check Gmail Sent before retrying.",
            ) from exc
    return {"ok": True, "message": "Gmail accepted the message send request."}


@app.get("/api/followups")
def followups(user: User = Depends(get_current_user)):
    return [_followup_dict(event) for event in get_followups(owner_id=user.id)]


@app.post("/api/followups/{event_id}/complete")
def review_followup(event_id: int, user: User = Depends(get_current_user)):
    try:
        complete_followup(event_id, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/replies/sync")
def sync_replies(user: User = Depends(get_current_user)):
    try:
        count = sync_replies_best_effort(GmailService().connect(), user.id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Reply sync failed: {exc}") from exc
    return {"updated": count}


@app.get("/api/settings")
def get_settings(user: User = Depends(get_current_user)):
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
async def upload_resume(file: UploadFile = File(...), user: User = Depends(get_current_user)):
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
def connect_gmail(user: User = Depends(get_current_user)):
    try:
        GmailService().connect()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gmail connection failed: {exc}") from exc
    return {"ok": True}


@app.post("/api/settings/test-ai")
def test_ai(user: User = Depends(get_current_user)):
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
