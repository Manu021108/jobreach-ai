from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from email_validator import validate_email, EmailNotValidError
from app.config import settings
from app.db.models import Contact, EmailDraft, JobPosting, OutreachEvent
from app.db.session import SessionLocal
from app.utils import website_from_email


def _owned(model, owner_id):
    return model.owner_id == int(owner_id) if owner_id is not None else True


def add_contacts(records, owner_id=None):
    added, skipped, errors = 0, 0, []
    with SessionLocal() as db:
        stmt = select(Contact.email, Contact.company_name)
        if owner_id is not None:
            stmt = stmt.where(Contact.owner_id == int(owner_id))
        existing_pairs = set(db.execute(stmt).all())
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
                owner_id=int(owner_id) if owner_id is not None else None,
            )
            db.add(contact)
            existing_pairs.add(pair)
            added += 1
        db.commit()
    return added, skipped, errors


def get_contacts(status=None, owner_id=None):
    with SessionLocal() as db:
        stmt = select(Contact).where(_owned(Contact, owner_id)).order_by(Contact.created_at.desc())
        if status and status != "All":
            stmt = stmt.where(Contact.status == status)
        return list(db.scalars(stmt).all())


def get_contact(contact_id, owner_id=None):
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if contact and owner_id is not None and contact.owner_id != int(owner_id):
            return None
        return contact


def save_draft(contact_id, subject, body, job_id=None, owner_id=None):
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact or (owner_id is not None and contact.owner_id != int(owner_id)):
            raise ValueError("Contact not found")
        draft = EmailDraft(
            contact_id=contact.id, subject=subject.strip(), body=body.strip(),
            status="DRAFT", job_id=job_id,
            owner_id=int(owner_id) if owner_id is not None else contact.owner_id,
        )
        db.add(draft)
        db.flush()
        contact.status = "DRAFTED"
        db.commit()
        return draft.id


def update_draft(draft_id, subject, body, owner_id=None):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if not draft or (owner_id is not None and draft.owner_id != int(owner_id)):
            raise ValueError("Draft not found")
        if draft.status == "SENT":
            raise ValueError("A sent email cannot be edited")
        draft.subject, draft.body = subject.strip(), body.strip()
        draft.status = "DRAFT"
        draft.approved_at = None
        db.commit()


def get_drafts(status=None, owner_id=None):
    with SessionLocal() as db:
        stmt = (
            select(EmailDraft)
            .options(joinedload(EmailDraft.contact))
            .where(_owned(EmailDraft, owner_id))
            .order_by(EmailDraft.created_at.desc())
        )
        if status:
            stmt = stmt.where(EmailDraft.status == status)
        return list(db.scalars(stmt).all())


def approve_draft(draft_id, owner_id=None):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if not draft or (owner_id is not None and draft.owner_id != int(owner_id)):
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


def mark_sent(draft_id, message_id, thread_id, followup_days=None, owner_id=None):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if not draft or (owner_id is not None and draft.owner_id != int(owner_id)):
            raise ValueError("Draft not found")
        if draft.status != "APPROVED":
            raise ValueError("Only approved drafts can be sent")
        contact = draft.contact
        if contact.opted_out:
            raise ValueError("Contact has opted out")
        now = datetime.now(timezone.utc)
        due = now + timedelta(days=followup_days or settings.followup_default_days)
        event = OutreachEvent(
            contact_id=contact.id, draft_id=draft.id, event_type="SENT",
            message_id=message_id or "", thread_id=thread_id or "",
            details="Gmail API accepted send request", occurred_at=now, followup_due_at=due,
            owner_id=int(owner_id) if owner_id is not None else draft.owner_id,
        )
        db.add(event)
        draft.status = "SENT"
        contact.status = "SENT"
        db.commit()


def record_failed(draft_id, error, owner_id=None):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if draft and (owner_id is None or draft.owner_id == int(owner_id)):
            db.add(OutreachEvent(
                contact_id=draft.contact_id, draft_id=draft.id, event_type="FAILED",
                details=str(error)[:2000], owner_id=draft.owner_id,
            ))
            draft.status = "FAILED"
            draft.contact.status = "FAILED"
            db.commit()


def set_contact_status(contact_id, status, owner_id=None):
    allowed = {"PENDING", "REPLIED", "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED"}
    if status not in allowed:
        raise ValueError("Invalid status")
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact or (owner_id is not None and contact.owner_id != int(owner_id)):
            raise ValueError("Contact not found")
        contact.status = status
        if status == "OPTED_OUT":
            contact.opted_out = True
        db.add(OutreachEvent(
            contact_id=contact.id, event_type=status, details="Status updated manually",
            owner_id=contact.owner_id,
        ))
        db.commit()


def get_followups(include_completed=False, owner_id=None):
    now = datetime.utcnow()
    with SessionLocal() as db:
        stmt = (
            select(OutreachEvent)
            .options(joinedload(OutreachEvent.contact))
            .where(OutreachEvent.event_type == "SENT")
            .where(_owned(OutreachEvent, owner_id))
        )
        if not include_completed:
            stmt = stmt.where(OutreachEvent.completed.is_(False))
        stmt = stmt.order_by(OutreachEvent.followup_due_at.asc())
        rows = list(db.scalars(stmt).all())
        return [r for r in rows if r.followup_due_at and r.followup_due_at <= now] + [
            r for r in rows if r.followup_due_at and r.followup_due_at > now
        ]


def complete_followup(event_id, outcome="Reminder reviewed", owner_id=None):
    with SessionLocal() as db:
        event = db.get(OutreachEvent, int(event_id))
        if not event or (owner_id is not None and event.owner_id != int(owner_id)):
            raise ValueError("Follow-up not found")
        event.completed = True
        db.add(OutreachEvent(
            contact_id=event.contact_id, event_type="FOLLOWUP_REVIEWED",
            details=outcome, owner_id=event.owner_id,
        ))
        db.commit()


def dashboard_stats(owner_id=None):
    with SessionLocal() as db:
        count = lambda stmt: db.scalar(stmt) or 0
        contacts = _owned(Contact, owner_id)
        drafts = _owned(EmailDraft, owner_id)
        events = _owned(OutreachEvent, owner_id)
        return {
            "contacts": count(select(func.count(Contact.id)).where(contacts)),
            "sent": count(select(func.count(OutreachEvent.id)).where(events, OutreachEvent.event_type == "SENT")),
            "replies": count(select(func.count(Contact.id)).where(contacts, Contact.status == "REPLIED")),
            "opted_out": count(select(func.count(Contact.id)).where(contacts, Contact.opted_out.is_(True))),
            "pending": count(select(func.count(Contact.id)).where(contacts, Contact.status == "PENDING")),
            "approved": count(select(func.count(EmailDraft.id)).where(drafts, EmailDraft.status == "APPROVED")),
            "failed": count(select(func.count(OutreachEvent.id)).where(events, OutreachEvent.event_type == "FAILED")),
        }


def sent_today_count(owner_id=None):
    local_now = datetime.now(ZoneInfo(settings.timezone))
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    with SessionLocal() as db:
        return db.scalar(
            select(func.count(OutreachEvent.id)).where(
                _owned(OutreachEvent, owner_id),
                OutreachEvent.event_type == "SENT",
                OutreachEvent.occurred_at >= start,
            )
        ) or 0


def sync_replies_best_effort(gmail, owner_id=None):
    """Best-effort inbox matching by sender address. Verify matches manually."""
    messages = gmail.list_recent_inbox(100)
    updated = 0
    with SessionLocal() as db:
        stmt = select(Contact).where(Contact.status == "SENT", _owned(Contact, owner_id))
        by_email = {c.email.lower(): c for c in db.scalars(stmt).all()}
        for item in messages:
            try:
                msg = gmail.get_message(item["id"])
                headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                sender = headers.get("from", "").lower()
                matched = next((c for addr, c in by_email.items() if addr in sender), None)
                if matched and matched.status == "SENT":
                    matched.status = "REPLIED"
                    db.add(OutreachEvent(
                        contact_id=matched.id, event_type="REPLIED",
                        message_id=item["id"], thread_id=msg.get("threadId", ""),
                        details="Potential reply matched by sender; verify in Gmail",
                        owner_id=matched.owner_id,
                    ))
                    updated += 1
            except Exception:
                continue
        db.commit()
    return updated


def get_jobs(contact_id, owner_id=None):
    with SessionLocal() as db:
        stmt = (
            select(JobPosting)
            .where(JobPosting.contact_id == int(contact_id))
            .where(_owned(JobPosting, owner_id))
            .order_by(JobPosting.created_at.desc())
        )
        return list(db.scalars(stmt).all())


def get_job(job_id, owner_id=None):
    with SessionLocal() as db:
        job = db.get(JobPosting, int(job_id))
        if job and owner_id is not None and job.owner_id != int(owner_id):
            return None
        return job


def save_jobs(contact_id, jobs, owner_id=None):
    added, skipped = 0, 0
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact or (owner_id is not None and contact.owner_id != int(owner_id)):
            raise ValueError("Contact not found")
        stmt = select(JobPosting.url).where(JobPosting.contact_id == int(contact_id))
        existing = set(db.scalars(stmt).all())
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
                owner_id=int(owner_id) if owner_id is not None else contact.owner_id,
            ))
            existing.add(url)
            added += 1
        db.commit()
    return added, skipped


def update_job_match(job_id, score, reasons, owner_id=None):
    with SessionLocal() as db:
        job = db.get(JobPosting, int(job_id))
        if not job or (owner_id is not None and job.owner_id != int(owner_id)):
            raise ValueError("Job not found")
        job.match_score = int(score)
        job.match_reasons = str(reasons)
        db.commit()
        db.refresh(job)
        return job


def update_contact_website(contact_id, website, owner_id=None):
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact or (owner_id is not None and contact.owner_id != int(owner_id)):
            raise ValueError("Contact not found")
        contact.website = website_from_email(contact.email, website)
        db.commit()
        db.refresh(contact)
        return contact
