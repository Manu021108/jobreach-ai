import hmac
import html
import io
import re
import tempfile
import threading
from urllib.parse import quote
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles

from app.config import settings
from app.db.models import Contact, OutreachEvent, User
from app.db.session import SessionLocal, init_db
from app.services import audit as audit_service
from app.services import auth as auth_service
from app.services import auto_sender
from app.services import billing as billing_service
from app.services import campaign as campaign_service
from app.services import compliance
from app.services import followups as followup_service
from app.services import gmail_service, gmail_tokens, hr_database, job_alerts, profile_service
from app.services import job_discovery_engine, job_discovery_worker
from app.services.ai_writer import AIWriter
from app.services.gmail_service import GmailService
from app.services.security import (
    OAUTH_STATE_MAX_AGE,
    SESSION_MAX_AGE,
    make_oauth_state,
    make_session,
    read_oauth_state,
    read_session,
)
from app.services.job_discovery import discover_jobs
from app.services.job_matcher import match_job
from app.services.outreach import (
    add_contacts,
    analytics_summary,
    approve_draft,
    complete_followup,
    create_contact,
    dashboard_stats,
    followup_counts,
    get_contact,
    get_contacts,
    get_drafts,
    get_followups,
    get_job,
    get_jobs,
    inbox_threads,
    list_all_jobs,
    mark_sent,
    record_failed,
    save_draft,
    save_jobs,
    sent_today_count,
    set_contact_status,
    sync_inbox_best_effort,
    unsubscribe_contact,
    update_contact_website,
    update_draft,
    update_job_match,
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.auto_send_worker_enabled:
        auto_sender.start_worker()
    if settings.followup_auto_draft_enabled:
        followup_service.start_worker()
    job_discovery_worker.start_worker()
    try:
        yield
    finally:
        job_discovery_worker.stop_worker()
        followup_service.stop_worker()
        auto_sender.stop_worker()


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


class ContactCreateInput(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    hr_name: str = Field(default="Hiring Team", max_length=200)
    role: str = Field(default="Relevant Opportunities", max_length=200)
    company_context: str = Field(default="", max_length=20_000)
    job_url: str = Field(default="", max_length=1000)
    source_url: str = Field(default="", max_length=1000)
    location: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=20_000)
    website: str = Field(default="", max_length=500)


class GenerateInput(BaseModel):
    company_context: str = Field(default="", max_length=20_000)
    mode: Literal["application", "general", "recruiter", "hr", "followup", "referral"] = "general"


class WebsiteUpdate(BaseModel):
    website: str = Field(max_length=500)


class DraftInput(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=50_000)


class SendConfirmation(BaseModel):
    reviewed: bool
    typed_recipient: str


class CampaignGenerateInput(BaseModel):
    contact_ids: list[int] = Field(min_length=1, max_length=50)


class CampaignApproveInput(BaseModel):
    draft_ids: list[int] = Field(min_length=1, max_length=50)


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


class DryRunUpdate(BaseModel):
    dry_run: bool


class ResetPasswordInput(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class ProfileInput(BaseModel):
    full_name: str = Field(max_length=200)
    phone: str = Field(default="", max_length=50)
    location: str = Field(default="", max_length=200)
    linkedin: str = Field(default="", max_length=500)
    github: str = Field(default="", max_length=500)
    summary: str = Field(default="", max_length=20_000)
    skills: str = Field(default="", max_length=5_000)
    target_roles: str = Field(default="", max_length=500)


class HRImportInput(BaseModel):
    query: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=200)
    verified: bool | None = None
    limit: int = Field(default=100, ge=1, le=5000)


class JobDiscoveryInput(BaseModel):
    query: str = Field(default="", max_length=300)
    company: str = Field(default="", max_length=200)
    skills: str | list[str] | None = None
    location: str = Field(default="", max_length=200)
    experience: str | list[str] | None = None
    salary_min: int | None = Field(default=None, ge=0)
    fresher_only: bool = False
    sources: str | list[str] | None = None
    include_companies: bool = True
    posted_within_days: int | None = Field(default=None, ge=1, le=365)
    min_match_score: int | None = Field(default=None, ge=0, le=100)
    sort: str = Field(default="newest", max_length=20)


class JobAlertInput(BaseModel):
    name: str = Field(default="New opportunities", min_length=1, max_length=200)
    query: str = Field(default="", max_length=300)
    skills: str | list[str] | None = None
    location: str = Field(default="", max_length=200)
    experience: str | list[str] | None = None
    salary_min: int | None = Field(default=None, ge=0)
    fresher_only: bool = False
    sources: str | list[str] | None = None
    active: bool = True
    email_enabled: bool = False
    include_companies: bool = True


class JobAlertUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    query: str | None = Field(default=None, max_length=300)
    skills: str | list[str] | None = None
    location: str | None = Field(default=None, max_length=200)
    experience: str | list[str] | None = None
    salary_min: int | None = Field(default=None, ge=0)
    fresher_only: bool | None = None
    sources: str | list[str] | None = None
    active: bool | None = None
    email_enabled: bool | None = None
    include_companies: bool | None = None


def _iso(value):
    return value.isoformat() if value else None


def _user_dict(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "is_verified": user.is_verified,
        "onboarding_completed": bool(user.onboarding_completed),
        "dry_run": compliance.dry_run_enabled(user),
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


def require_hr_database_unlock(user: User = Depends(get_current_user)) -> User:
    if not billing_service.has_entitlement(user.id):
        raise HTTPException(status_code=402, detail="Unlock the HR database to use this feature.")
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
    return job_discovery_engine.job_payload(job)


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
        "followup_draft_id": event.followup_draft_id,
        "completed": event.completed,
        "contact": _contact_dict(event.contact),
    }


def _user_resume(user):
    return profile_service.get_resume(user.id)


def _resume_filename(user):
    resume = _user_resume(user)
    return resume.filename if resume else "resume.pdf"


def _send_resume_path(user):
    resume = _user_resume(user)
    if not resume:
        return None
    suffix = Path(resume.filename).suffix.lower()
    suffix = suffix if suffix == ".pdf" else ".pdf"
    temp = tempfile.NamedTemporaryFile(prefix="jobreach-resume-", suffix=suffix, delete=False)
    with temp:
        temp.write(resume.content)
    return Path(temp.name)


def _sync_onboarding(user_id):
    status = profile_service.onboarding_status(user_id)
    if status["profile_complete"] and status["resume_uploaded"] and not status["completed"]:
        profile_service.complete_onboarding(user_id)
        status = profile_service.onboarding_status(user_id)
    return status


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


def _send_block_reason(draft, confirmation, sent_today, sent_this_run, last_sent_at, now, is_followup=False, dry_run=None):
    dry_run = settings.dry_run if dry_run is None else bool(dry_run)
    if dry_run:
        return "Dry-run is enabled. Sending is disabled."
    if draft.status != "APPROVED":
        return "Only approved drafts can be sent."
    if draft.contact.opted_out or draft.contact.status in {
        "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED",
    }:
        return "This contact is no longer eligible for outreach."
    if draft.contact.status == "SENT" and not is_followup:
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


@app.get("/api/gmail/oauth/start")
def gmail_oauth_start(user: User = Depends(get_current_user)):
    try:
        state = make_oauth_state(user.id)
        authorization_url = gmail_service.authorization_url(state)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    response = JSONResponse({"authorization_url": authorization_url})
    response.set_cookie(
        "jr_gmail_state", state, max_age=OAUTH_STATE_MAX_AGE,
        httponly=True, samesite="lax", secure=settings.auth_cookie_secure, path="/",
    )
    return response


@app.get("/api/gmail/oauth/callback")
def gmail_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    jr_gmail_state: str | None = Cookie(default=None, alias="jr_gmail_state"),
    user: User = Depends(get_current_user),
):
    expected_user = read_oauth_state(state) if state else None
    if (
        error
        or not code
        or not state
        or expected_user is None
        or expected_user != user.id
        or not jr_gmail_state
        or not hmac.compare_digest(state, jr_gmail_state)
    ):
        detail = error or "Invalid or expired Gmail authorization request."
        return RedirectResponse(f"/?gmail=error&detail={quote(str(detail)[:200])}", status_code=303)
    try:
        credentials, email = gmail_service.complete_oauth(code)
        gmail_tokens.save_credentials(user.id, credentials, email)
    except Exception as exc:
        return RedirectResponse(f"/?gmail=error&detail={quote(str(exc)[:200])}", status_code=303)
    response = RedirectResponse("/?gmail=connected", status_code=303)
    response.delete_cookie("jr_gmail_state", path="/")
    return response


@app.post("/api/gmail/disconnect")
def gmail_disconnect(user: User = Depends(get_current_user)):
    gmail_tokens.delete_credentials(user.id)
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard(user: User = Depends(get_current_user)):
    sent_today = sent_today_count(user.id)
    stats = dashboard_stats(user.id)
    stats["remaining_today"] = max(0, settings.max_emails_per_day - sent_today)
    return {
        "stats": stats,
        "sent_today": sent_today,
        "daily_cap": settings.max_emails_per_day,
        "run_cap": settings.max_emails_per_run,
        "dry_run": compliance.dry_run_enabled(user),
        "followups": followup_counts(user.id),
        "recent_contacts": [_contact_dict(contact) for contact in get_contacts(owner_id=user.id)[:15]],
    }


@app.get("/api/analytics")
def analytics(days: int = 30, user: User = Depends(get_current_user)):
    return analytics_summary(user.id, days)


@app.get("/api/inbox")
def inbox(limit: int = 50, user: User = Depends(get_current_user)):
    return inbox_threads(user.id, limit)


@app.get("/api/contacts")
def contacts(status: str = "All", user: User = Depends(get_current_user)):
    if status != "All" and status not in _all_statuses:
        raise HTTPException(status_code=400, detail="Invalid contact status filter.")
    return [_contact_dict(contact) for contact in get_contacts(status, user.id)]


@app.post("/api/contacts")
def add_single_contact(payload: ContactCreateInput, user: User = Depends(get_current_user)):
    try:
        contact = create_contact(payload.model_dump(), user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _contact_dict(contact)


@app.get("/api/jobs")
def all_jobs(
    query: str = "",
    company: str = "",
    location: str = "",
    active: bool | None = None,
    page: int = 1,
    page_size: int = 50,
    skills: str = "",
    experience: str = "",
    salary_min: int | None = None,
    fresher_only: bool = False,
    sources: str = "",
    posted_within_days: int | None = None,
    sort: str = "newest",
    user: User = Depends(get_current_user),
):
    return list_all_jobs(
        user.id,
        query,
        company,
        location,
        active,
        page,
        page_size,
        skills,
        experience,
        salary_min,
        fresher_only,
        sources,
        posted_within_days,
        sort,
    )


@app.post("/api/jobs/discover")
def discover_jobs_globally(
    payload: JobDiscoveryInput | None = None,
    user: User = Depends(get_current_user),
):
    values = payload.model_dump() if payload else {}
    return job_discovery_engine.discover_for_owner(user.id, values)


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
    result = match_job(job, profile_service.ai_profile(user.id))
    update_job_match(job_id, result["score"], "; ".join(result["reasons"]), user.id)
    return {"job": _job_dict(get_job(job_id, user.id)), **result}


@app.post("/api/jobs/{job_id}/generate")
def generate_job_draft(job_id: int, user: User = Depends(get_current_user)):
    job = get_job(job_id, user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if not job.contact_id:
        raise HTTPException(status_code=409, detail="This portal role has no outreach contact. Create a contact first.")
    with SessionLocal() as db:
        contact = db.get(Contact, job.contact_id)
    if not contact or contact.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Contact not found.")
    if contact.opted_out or contact.status in {"SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}:
        raise HTTPException(status_code=409, detail="This contact is not eligible for a new draft.")
    profile = profile_service.ai_profile(user.id)
    match = match_job(job, profile)
    if job.match_score is not None:
        match["score"] = job.match_score
    try:
        generated = AIWriter(profile).generate_for_job(contact, job, match, _resume_filename(user))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {exc}") from exc
    draft_id = save_draft(contact.id, generated["subject"], generated["body"], job.id, user.id)
    return {"id": draft_id, **generated, "job": _job_dict(job)}


@app.post("/api/jobs/{job_id}/drafts")
def create_job_draft(job_id: int, payload: DraftInput, user: User = Depends(get_current_user)):
    job = get_job(job_id, user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if not job.contact_id:
        raise HTTPException(status_code=409, detail="This portal role has no outreach contact.")
    draft_id = save_draft(job.contact_id, payload.subject, payload.body, job.id, user.id)
    return {"id": draft_id}


@app.get("/api/job-alerts")
def list_job_alerts(user: User = Depends(get_current_user)):
    return job_alerts.list_alerts(user.id)


@app.post("/api/job-alerts")
def create_job_alert(payload: JobAlertInput, user: User = Depends(get_current_user)):
    alert = job_alerts.create_alert(user.id, payload.model_dump())
    audit_service.log(user.id, "JOB_ALERT_CREATED", f"alert={alert['name'][:80]}")
    return alert


@app.put("/api/job-alerts/{alert_id}")
def update_job_alert(alert_id: int, payload: JobAlertUpdate, user: User = Depends(get_current_user)):
    alert = job_alerts.update_alert(alert_id, user.id, payload.model_dump(exclude_unset=True))
    if not alert:
        raise HTTPException(status_code=404, detail="Job alert not found.")
    return alert


@app.delete("/api/job-alerts/{alert_id}")
def delete_job_alert(alert_id: int, user: User = Depends(get_current_user)):
    if not job_alerts.delete_alert(alert_id, user.id):
        raise HTTPException(status_code=404, detail="Job alert not found.")
    audit_service.log(user.id, "JOB_ALERT_DELETED", f"alert_id={alert_id}")
    return {"ok": True}


@app.post("/api/job-alerts/{alert_id}/run")
def run_job_alert(alert_id: int, user: User = Depends(get_current_user)):
    result = job_alerts.run_alert(user.id, alert_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job alert not found.")
    return result


@app.get("/api/job-notifications")
def list_job_notifications(limit: int = 50, unread_only: bool = False, user: User = Depends(get_current_user)):
    return job_alerts.list_notifications(user.id, limit, unread_only)


@app.get("/api/job-notifications/unread-count")
def job_notification_unread_count(user: User = Depends(get_current_user)):
    return {"count": job_alerts.unread_count(user.id)}


@app.post("/api/job-notifications/read-all")
def mark_all_job_notifications_read(user: User = Depends(get_current_user)):
    return {"updated": job_alerts.mark_all_read(user.id)}


@app.post("/api/job-notifications/{notification_id}/read")
def mark_job_notification_read(notification_id: int, user: User = Depends(get_current_user)):
    if not job_alerts.mark_notification_read(notification_id, user.id):
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"ok": True}


@app.get("/api/campaigns")
def campaigns(user: User = Depends(get_current_user)):
    return campaign_service.list_campaigns(user.id)


@app.post("/api/campaigns/generate")
def generate_campaign_drafts(payload: CampaignGenerateInput, user: User = Depends(get_current_user)):
    try:
        return campaign_service.generate_drafts(
            user.id,
            payload.contact_ids,
            profile_service.ai_profile(user.id),
            _resume_filename(user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/approve")
def approve_campaign_drafts(
    campaign_id: int,
    payload: CampaignApproveInput,
    user: User = Depends(get_current_user),
):
    try:
        return campaign_service.approve_drafts(campaign_id, user.id, payload.draft_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/queue")
def queue_campaign(campaign_id: int, user: User = Depends(get_current_user)):
    try:
        return campaign_service.queue_campaign(campaign_id, user.id)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 409
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/start")
def start_campaign(campaign_id: int, user: User = Depends(get_current_user)):
    try:
        return auto_sender.start_campaign(campaign_id, user.id)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 409
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/pause")
def pause_campaign(campaign_id: int, user: User = Depends(get_current_user)):
    try:
        return auto_sender.pause_campaign(campaign_id, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/contacts/{contact_id}/generate")
def generate_draft(contact_id: int, payload: GenerateInput, user: User = Depends(get_current_user)):
    with SessionLocal() as db:
        contact = db.get(Contact, contact_id)
        if not contact or contact.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Contact not found.")
        if contact.opted_out or contact.status in {"SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}:
            raise HTTPException(status_code=409, detail="This contact is not eligible for a new draft.")
        contact.company_context = payload.company_context
        db.commit()
        try:
            generated = AIWriter(profile_service.ai_profile(user.id)).generate(
                contact, _resume_filename(user), mode=payload.mode
            )
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
    campaign_service.sync_draft_state(draft_id, user.id, "DRAFT")
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/approve")
def approve_email_draft(draft_id: int, user: User = Depends(get_current_user)):
    _get_owned_draft(draft_id, user.id)
    try:
        approve_draft(draft_id, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    campaign_service.sync_draft_state(draft_id, user.id, "APPROVED")
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
        "body": compliance.with_opt_out(draft.body, draft.contact, user.id),
        "resume": _resume_filename(user) if _user_resume(user) else None,
        "job": job,
    }


@app.post("/api/drafts/{draft_id}/send")
def send_draft(draft_id: int, confirmation: SendConfirmation, user: User = Depends(get_current_user)):
    global _sent_this_run
    with _send_lock:
        draft = _get_owned_draft(draft_id, user.id)
        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            is_followup = bool(db.scalar(
                select(OutreachEvent.id).where(OutreachEvent.followup_draft_id == draft.id)
            ))
        reason = _send_block_reason(
            draft, confirmation, sent_today_count(user.id), _sent_this_run,
            _latest_send_at(user.id), now, is_followup=is_followup,
            dry_run=compliance.dry_run_enabled(user),
        )
        if reason:
            raise HTTPException(status_code=409, detail=reason)
        resume = _send_resume_path(user)
        if not resume:
            raise HTTPException(status_code=409, detail="Upload a PDF resume during onboarding or in Settings before sending.")
        try:
            response = GmailService(user.id).connect().send(
                draft.contact.email,
                draft.subject,
                compliance.with_opt_out(draft.body, draft.contact, user.id),
                resume,
                sender_name=profile_service.profile_dict(user.id)["full_name"],
            )
            mark_sent(draft.id, response.get("id", ""), response.get("threadId", ""), owner_id=user.id)
            campaign_service.sync_draft_state(draft.id, user.id, "SENT")
            _sent_this_run += 1
        except Exception as exc:
            campaign_service.sync_draft_state(draft.id, user.id, "FAILED")
            record_failed(draft.id, exc, user.id)
            raise HTTPException(
                status_code=502,
                detail=f"Send failed or returned an uncertain result: {exc}. Check Gmail Sent before retrying.",
            ) from exc
        finally:
            resume.unlink(missing_ok=True)
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


@app.post("/api/followups/run")
def run_followups(user: User = Depends(get_current_user)):
    return followup_service.run_once(owner_id=user.id)


@app.post("/api/replies/sync")
def sync_replies(user: User = Depends(get_current_user)):
    try:
        result = sync_inbox_best_effort(GmailService(user.id).connect(), user.id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Inbox sync failed: {exc}") from exc
    return {"updated": result["matched"], **result}


@app.post("/api/billing/checkout")
def billing_checkout(user: User = Depends(get_current_user)):
    try:
        return billing_service.create_checkout_session(user.id, user.email)
    except billing_service.BillingError as exc:
        status_code = 409 if "already" in str(exc).lower() else 503
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.post("/api/billing/free-unlock")
def billing_free_unlock(user: User = Depends(get_current_user)):
    if not settings.allow_free_unlock:
        raise HTTPException(status_code=403, detail="Free unlock is not available.")
    entitlement = billing_service.grant_free_access(user.id)
    records = hr_database.import_records(limit=5000)
    added, skipped, errors = add_contacts(records, user.id)
    return {**entitlement, "imported": added, "skipped": skipped, "errors": errors[:10]}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        return billing_service.handle_webhook(payload, signature)
    except billing_service.PaymentVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except billing_service.BillingError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/billing/entitlement")
def billing_entitlement(user: User = Depends(get_current_user)):
    return {
        **billing_service.entitlement_status(user.id),
        "order": billing_service.latest_order(user.id),
        "amount_total": settings.stripe_unlock_amount,
        "currency": settings.stripe_unlock_currency.upper(),
        "free_unlock_enabled": settings.allow_free_unlock,
    }


@app.get("/api/hr-database")
def hr_database_rows(
    query: str = "",
    company: str = "",
    role: str = "",
    verified: bool | None = None,
    page: int = 1,
    page_size: int = 25,
    user: User = Depends(get_current_user),
):
    unlocked = billing_service.has_entitlement(user.id)
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    if not unlocked:
        return {
            "total": hr_database.total_count(),
            "filtered_total": 0,
            "verified_total": hr_database.verified_count(),
            "page": page,
            "page_size": page_size,
            "page_count": 0,
            "rows": [],
            "unlocked": False,
            "preview": hr_database.preview(),
        }
    result = hr_database.query_records(
        query=query,
        company=company,
        role=role,
        verified=verified,
        limit=page_size,
        offset=(page - 1) * page_size,
    )
    result.update({"unlocked": True, "preview": [], "page": page, "page_size": page_size})
    return result


@app.post("/api/hr-database/import")
def import_hr_database(payload: HRImportInput, user: User = Depends(require_hr_database_unlock)):
    records = hr_database.import_records(
        limit=payload.limit,
        query=payload.query,
        company=payload.company,
        role=payload.role,
        verified=payload.verified,
    )
    added, skipped, errors = add_contacts(records, user.id)
    return {"added": added, "skipped": skipped, "errors": errors[:10]}


@app.get("/api/profile")
def get_profile(user: User = Depends(get_current_user)):
    data = profile_service.profile_dict(user.id)
    gmail_status = gmail_tokens.connection_status(user.id)
    data["sender_email"] = gmail_status["email"] or data["email"]
    data["onboarding"] = profile_service.onboarding_status(user.id)
    return data


@app.put("/api/profile")
def update_profile(payload: ProfileInput, user: User = Depends(get_current_user)):
    profile_service.save_profile(user.id, payload.model_dump())
    refreshed = auth_service.get_user(user.id)
    return {
        **profile_service.profile_dict(user.id),
        "user": _user_dict(refreshed),
        "onboarding": _sync_onboarding(user.id),
    }


@app.post("/api/onboarding/complete")
def complete_onboarding(user: User = Depends(get_current_user)):
    try:
        updated = profile_service.complete_onboarding(user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"user": _user_dict(updated), "onboarding": profile_service.onboarding_status(user.id)}


async def _store_resume(file, user):
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
    resume = profile_service.save_resume(user.id, safe_name, content)
    return {"resume_name": resume.filename, "onboarding": _sync_onboarding(user.id)}


@app.post("/api/profile/resume")
async def upload_profile_resume(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    return await _store_resume(file, user)


@app.delete("/api/profile/resume")
def delete_profile_resume(user: User = Depends(get_current_user)):
    profile_service.delete_resume(user.id)
    return {"resume_name": None, "onboarding": profile_service.onboarding_status(user.id)}


@app.post("/api/settings/resume")
async def upload_settings_resume(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    return await _store_resume(file, user)


@app.get("/api/settings")
def get_settings(user: User = Depends(get_current_user)):
    profile = profile_service.profile_dict(user.id)
    gmail_status = gmail_tokens.connection_status(user.id)
    return {
        "app_name": settings.app_name,
        "sender_name": profile["full_name"],
        "sender_email": gmail_status["email"] or profile["email"],
        "profile_summary": profile["summary"],
        "skills": profile["skills"],
        "target_roles": profile["target_roles"],
        "phone": profile["phone"],
        "location": profile["location"],
        "linkedin": profile["linkedin"],
        "github": profile["github"],
        "ai_provider": settings.ai_provider,
        "ai_model": settings.ai_model,
        "ai_base_url": settings.ai_base_url,
        "dry_run": compliance.dry_run_enabled(user),
        "max_emails_per_run": settings.max_emails_per_run,
        "max_emails_per_day": settings.max_emails_per_day,
        "min_seconds_between_emails": settings.min_seconds_between_emails,
        "followup_auto_draft_enabled": settings.followup_auto_draft_enabled,
        "followup_poll_seconds": settings.followup_poll_seconds,
        "followup_max_per_run": settings.followup_max_per_run,
        "job_discovery_enabled": settings.job_discovery_enabled,
        "job_discovery_poll_seconds": settings.job_discovery_poll_seconds,
        "job_discovery_portals": settings.job_discovery_portals,
        "job_discovery_max_per_source": settings.job_discovery_max_per_source,
        "job_alert_email_enabled": settings.job_alert_email_enabled,
        "job_alert_unread_count": job_alerts.unread_count(user.id),
        "resume_name": profile["resume_name"],
        "onboarding": profile_service.onboarding_status(user.id),
        "hr_database_unlocked": billing_service.has_entitlement(user.id),
        "hr_database_count": hr_database.total_count(),
        "hr_database_verified_count": hr_database.verified_count(),
        "unlock_amount": settings.stripe_unlock_amount,
        "unlock_currency": settings.stripe_unlock_currency.upper(),
        "gmail_connected": gmail_status["connected"],
        "gmail_email": gmail_status["email"],
        "gmail_expires_at": gmail_status["expires_at"],
        "gmail_needs_reconnect": gmail_status["needs_reconnect"],
    }


@app.put("/api/settings/dry-run")
def update_dry_run(payload: DryRunUpdate, user: User = Depends(get_current_user)):
    with SessionLocal() as db:
        current = db.get(User, user.id)
        current.dry_run = payload.dry_run
        db.commit()
    audit_service.log(
        user.id,
        "DRY_RUN_ENABLED" if payload.dry_run else "DRY_RUN_DISABLED",
        "Per-user dry-run mode updated from Settings.",
    )
    return {"dry_run": payload.dry_run}


@app.get("/api/audit")
def audit_log(limit: int = 100, user: User = Depends(get_current_user)):
    return audit_service.list_logs(user.id, limit)


def _unsubscribe_page(result):
    if result["ok"]:
        title = "You have been unsubscribed"
        detail = (
            f"{result['company_name']} ({result['email']}) will not receive further "
            "emails from this JobReach AI workspace."
        )
        if result.get("already_opted_out"):
            detail = "This address was already opted out. No further emails will be sent."
    else:
        title = "Unsubscribe link unavailable"
        detail = result["message"]
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} | JobReach AI</title>
<style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F9F7;color:#163025;font:15px/1.6 system-ui,sans-serif}}
main{{width:min(560px,calc(100% - 32px));padding:32px;border:1px solid #DDE6DF;border-radius:18px;background:#fff;box-shadow:0 12px 40px rgba(22,48,37,.08)}}
h1{{margin:0 0 8px;font-size:24px}}p{{margin:0;color:#5B6B62}}a{{color:#187B61}}
</style></head>
<body><main><h1>{html.escape(title)}</h1><p>{html.escape(detail)}</p>
<p style="margin-top:18px"><a href="{html.escape(settings.frontend_url)}">Return to JobReach AI</a></p>
</main></body></html>"""


@app.get("/api/unsubscribe", response_class=HTMLResponse)
def unsubscribe(token: str = ""):
    return HTMLResponse(_unsubscribe_page(unsubscribe_contact(token)))


@app.post("/api/unsubscribe")
def unsubscribe_post(token: str = ""):
    return unsubscribe_contact(token)


@app.post("/api/settings/gmail")
def connect_gmail(user: User = Depends(get_current_user)):
    return gmail_oauth_start(user)


@app.post("/api/settings/test-ai")
def test_ai(user: User = Depends(get_current_user)):
    try:
        result = AIWriter(profile_service.ai_profile(user.id)).client.chat.completions.create(
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
