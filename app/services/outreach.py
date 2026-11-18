from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from email_validator import validate_email, EmailNotValidError
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.db.models import Contact, EmailDraft, JobPosting, OutreachEvent
from app.db.session import SessionLocal
from app.utils import website_from_email


def add_contacts(records):
    added, skipped, errors = 0, 0, []
    with SessionLocal() as db:
        existing_pairs = set(db.execute(select(Contact.email, Contact.company_name)).all())
        for idx, item in enumerate(records, start=1):
            email = str(item.get("email", "")).strip().lower()
            company = str(item.get("company_name", "")).strip()
            if not company:
                skipped += 1
                errors.append(f"Row {idx}: company_name is required")
                continue
            try:
                email = validate_email(email, check_deliverability=False).normalized
            except EmailNotValidError:
                skipped += 1
                errors.append(f"Row {idx}: invalid email address")
                continue
            pair = (email, company)
            if pair in existing_pairs:
                skipped += 1
                continue
            contact = Contact(
                company_name=company[:200], email=email[:320],
                hr_name=str(item.get("hr_name") or "Hiring Team")[:200],
                role=str(item.get("role") or "Relevant Opportunities")[:200],
                company_context=str(item.get("company_context") or ""),
                job_url=str(item.get("job_url") or ""), source_url=str(item.get("source_url") or ""),
                location=str(item.get("location") or ""), notes=str(item.get("notes") or ""),
                website=website_from_email(email, item.get("website")),
            )
            db.add(contact)
            existing_pairs.add(pair)
            added += 1
        db.commit()
    return added, skipped, errors


def get_contacts(status=None):
    with SessionLocal() as db:
        stmt = select(Contact).order_by(Contact.created_at.desc())
        if status and status != "All":
            stmt = stmt.where(Contact.status == status)
        return list(db.scalars(stmt).all())


def get_contact(contact_id):
    with SessionLocal() as db:
        return db.get(Contact, int(contact_id))


def save_draft(contact_id, subject, body, job_id=None):
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact:
            raise ValueError("Contact not found")
        draft = EmailDraft(contact_id=contact.id, subject=subject.strip(), body=body.strip(), status="DRAFT", job_id=job_id)
        db.add(draft)
        db.flush()
        contact.status = "DRAFTED"
        db.commit()
        return draft.id


def update_draft(draft_id, subject, body):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if not draft:
            raise ValueError("Draft not found")
        if draft.status == "SENT":
            raise ValueError("A sent email cannot be edited")
        draft.subject, draft.body = subject.strip(), body.strip()
        draft.status = "DRAFT"
        draft.approved_at = None
        db.commit()


def get_drafts(status=None):
    with SessionLocal() as db:
        stmt = select(EmailDraft).options(joinedload(EmailDraft.contact)).order_by(EmailDraft.created_at.desc())
        if status:
            stmt = stmt.where(EmailDraft.status == status)
        return list(db.scalars(stmt).all())


def approve_draft(draft_id):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if not draft:
            raise ValueError("Draft not found")
        if draft.status == "SENT":
            raise ValueError("A sent email cannot be approved again")
        if draft.contact.opted_out or draft.contact.status in {
            "SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED",
        }:
            raise ValueError("This contact is no longer eligible for outreach")
        draft.status = "APPROVED"
        draft.approved_at = datetime.now(timezone.utc)
        db.commit()


def mark_sent(draft_id, message_id, thread_id, followup_days=None):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if not draft or draft.status != "APPROVED":
            raise ValueError("Only approved drafts can be sent")
        contact = draft.contact
        if contact.opted_out:
            raise ValueError("Contact has opted out")
        now = datetime.now(timezone.utc)
        due = now + timedelta(days=followup_days or settings.followup_default_days)
        event = OutreachEvent(contact_id=contact.id, draft_id=draft.id, event_type="SENT", message_id=message_id or "", thread_id=thread_id or "", details="Gmail API accepted send request", occurred_at=now, followup_due_at=due)
        db.add(event)
        draft.status = "SENT"
        contact.status = "SENT"
        db.commit()


def record_failed(draft_id, error):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if draft:
            db.add(OutreachEvent(contact_id=draft.contact_id, draft_id=draft.id, event_type="FAILED", details=str(error)[:2000]))
            draft.status = "FAILED"
            draft.contact.status = "FAILED"
            db.commit()


def set_contact_status(contact_id, status):
    allowed = {"PENDING", "REPLIED", "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED"}
    if status not in allowed:
        raise ValueError("Invalid status")
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact:
            raise ValueError("Contact not found")
        contact.status = status
        if status == "OPTED_OUT":
            contact.opted_out = True
        db.add(OutreachEvent(contact_id=contact.id, event_type=status, details="Status updated manually"))
        db.commit()


def get_followups(include_completed=False):
    now = datetime.utcnow()
    with SessionLocal() as db:
        stmt = select(OutreachEvent).options(joinedload(OutreachEvent.contact)).where(OutreachEvent.event_type == "SENT")
        if not include_completed:
            stmt = stmt.where(OutreachEvent.completed.is_(False))
        stmt = stmt.order_by(OutreachEvent.followup_due_at.asc())
        rows = list(db.scalars(stmt).all())
        return [r for r in rows if r.followup_due_at and r.followup_due_at <= now] + [r for r in rows if r.followup_due_at and r.followup_due_at > now]


def complete_followup(event_id, outcome="Reminder reviewed"):
    with SessionLocal() as db:
        event = db.get(OutreachEvent, int(event_id))
        if not event:
            raise ValueError("Follow-up not found")
        event.completed = True
        db.add(OutreachEvent(contact_id=event.contact_id, event_type="FOLLOWUP_REVIEWED", details=outcome))
        db.commit()


def dashboard_stats():
    with SessionLocal() as db:
        count = lambda stmt: db.scalar(stmt) or 0
        return {
            "contacts": count(select(func.count(Contact.id))),
            "sent": count(select(func.count(OutreachEvent.id)).where(OutreachEvent.event_type == "SENT")),
            "replies": count(select(func.count(Contact.id)).where(Contact.status == "REPLIED")),
            "opted_out": count(select(func.count(Contact.id)).where(Contact.opted_out.is_(True))),
            "pending": count(select(func.count(Contact.id)).where(Contact.status == "PENDING")),
            "approved": count(select(func.count(EmailDraft.id)).where(EmailDraft.status == "APPROVED")),
            "failed": count(select(func.count(OutreachEvent.id)).where(OutreachEvent.event_type == "FAILED")),
        }


def sent_today_count():
    local_now = datetime.now(ZoneInfo(settings.timezone))
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    with SessionLocal() as db:
        return db.scalar(select(func.count(OutreachEvent.id)).where(OutreachEvent.event_type == "SENT", OutreachEvent.occurred_at >= start)) or 0


def sync_replies_best_effort(gmail):
    """Best-effort inbox matching by sender address. Verify matches manually."""
    messages = gmail.list_recent_inbox(100)
    updated = 0
    with SessionLocal() as db:
        sent_contacts = list(db.scalars(select(Contact).where(Contact.status == "SENT")).all())
        by_email = {c.email.lower(): c for c in sent_contacts}
        for item in messages:
            try:
                msg = gmail.get_message(item["id"])
                headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                sender = headers.get("from", "").lower()
                matched = next((c for addr, c in by_email.items() if addr in sender), None)
                if matched and matched.status == "SENT":
                    matched.status = "REPLIED"
                    db.add(OutreachEvent(contact_id=matched.id, event_type="REPLIED", message_id=item["id"], thread_id=msg.get("threadId", ""), details="Potential reply matched by sender; verify in Gmail"))
                    updated += 1
            except Exception:
                continue
        db.commit()
    return updated


def get_jobs(contact_id):
    with SessionLocal() as db:
        stmt = select(JobPosting).where(JobPosting.contact_id == int(contact_id)).order_by(JobPosting.created_at.desc())
        return list(db.scalars(stmt).all())


def get_job(job_id):
    with SessionLocal() as db:
        return db.get(JobPosting, int(job_id))


def save_jobs(contact_id, jobs):
    added, skipped = 0, 0
    with SessionLocal() as db:
        existing = set(db.scalars(select(JobPosting.url).where(JobPosting.contact_id == int(contact_id))).all())
        for item in jobs:
            url = str(item.get("url") or "").strip()
            if not url or url in existing:
                skipped += 1
                continue
            db.add(JobPosting(
                contact_id=int(contact_id),
                company_name=str(item.get("company_name") or "")[:200],
                title=str(item.get("title") or "Open Role")[:300],
                location=str(item.get("location") or "")[:200],
                description=str(item.get("description") or "")[:20000],
                url=url[:1000],
                apply_url=str(item.get("apply_url") or url)[:1000],
                source=str(item.get("source") or "careers_page")[:50],
                source_url=str(item.get("source_url") or url)[:1000],
                active=bool(item.get("active", True)),
                evidence=str(item.get("evidence") or ""),
                verified_at=datetime.now(timezone.utc),
            ))
            existing.add(url)
            added += 1
        db.commit()
    return added, skipped


def update_job_match(job_id, score, reasons):
    with SessionLocal() as db:
        job = db.get(JobPosting, int(job_id))
        if not job:
            raise ValueError("Job not found")
        job.match_score = int(score)
        job.match_reasons = str(reasons)
        db.commit()
        db.refresh(job)
        return job


def update_contact_website(contact_id, website):
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact:
            raise ValueError("Contact not found")
        contact.website = website_from_email(contact.email, website)
        db.commit()
        db.refresh(contact)
        return contact
