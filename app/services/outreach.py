from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import and_, select, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from email_validator import validate_email, EmailNotValidError
from app.config import settings
from app.db.models import Contact, EmailDraft, JobPosting, OutreachEvent
from app.db.session import SessionLocal
from app.services import audit, security
from app.utils import website_from_email


CONTACT_STATUSES = frozenset({
    "PENDING", "DRAFTED", "SENT", "REPLIED", "FAILED",
    "NOT_INTERESTED", "OPTED_OUT", "ARCHIVED",
})

_CONTACT_SEARCH_COLUMNS = (
    Contact.company_name, Contact.email, Contact.hr_name,
    Contact.role, Contact.location, Contact.website,
)

_CONTACT_SORT_ORDERS = {
    "recent": (Contact.updated_at.desc(), Contact.id.desc()),
    "created": (Contact.created_at.desc(), Contact.id.desc()),
    "oldest": (Contact.created_at.asc(), Contact.id.asc()),
    "company": (Contact.company_name.asc(), Contact.id.asc()),
    "status": (Contact.status.asc(), Contact.id.asc()),
}


def _owned(model, owner_id):
    return model.owner_id == int(owner_id) if owner_id is not None else True


def _owned_contact(model, owner_id):
    if owner_id is None:
        return True
    return model.contact.has(Contact.owner_id == int(owner_id))


def _owned_job(model, owner_id):
    if owner_id is None:
        return True
    return or_(
        model.contact_id.is_(None),
        model.contact.has(Contact.owner_id == int(owner_id)),
    )


def _job_owned(job, owner_id):
    if owner_id is None:
        return True
    contact = job.contact
    return bool(
        job.owner_id == int(owner_id)
        and (job.contact_id is None or (contact and contact.owner_id == int(owner_id)))
    )


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
            try:
                with db.begin_nested():
                    db.add(contact)
                    db.flush()
            except IntegrityError:
                skipped += 1
                errors.append(f"Row {idx}: contact already exists")
                continue
            existing_pairs.add(pair)
            added += 1
        db.commit()
    audit.log(
        owner_id, "CONTACTS_IMPORTED",
        f"Imported {added} contact(s); skipped {skipped}.",
    )
    return added, skipped, errors


def create_contact(data, owner_id=None):
    email = str(data.get("email", "")).strip().lower()
    company = str(data.get("company_name", "")).strip()
    if not company:
        raise ValueError("Company name is required")
    try:
        email = validate_email(email, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ValueError("Enter a valid email address") from exc
    with SessionLocal() as db:
        existing = db.scalar(select(Contact).where(
            Contact.owner_id == int(owner_id) if owner_id is not None else Contact.owner_id.is_(None),
            Contact.email == email,
            Contact.company_name == company,
        ))
        if existing:
            raise ValueError("This company contact already exists")
        contact = Contact(
            company_name=company[:200],
            email=email[:320],
            hr_name=str(data.get("hr_name") or "Hiring Team")[:200],
            role=str(data.get("role") or "Relevant Opportunities")[:200],
            company_context=str(data.get("company_context") or ""),
            job_url=str(data.get("job_url") or "")[:1000],
            source_url=str(data.get("source_url") or "")[:1000],
            location=str(data.get("location") or "")[:200],
            notes=str(data.get("notes") or ""),
            website=website_from_email(email, data.get("website")),
            owner_id=int(owner_id) if owner_id is not None else None,
        )
        db.add(contact)
        db.commit()
        db.refresh(contact)
    audit.log(
        owner_id,
        "CONTACT_CREATED",
        f"Added {company} ({email}) manually.",
        contact_id=contact.id,
    )
    return contact


def get_contacts(status=None, owner_id=None):
    with SessionLocal() as db:
        stmt = select(Contact).where(_owned(Contact, owner_id)).order_by(Contact.created_at.desc())
        if status and status != "All":
            stmt = stmt.where(Contact.status == status)
        return list(db.scalars(stmt).all())


def _contact_owner(owner_id):
    if owner_id is None:
        return Contact.owner_id.is_(None)
    return Contact.owner_id == int(owner_id)


def _contact_conditions(q="", eligible=False):
    conditions = []
    term = str(q or "").strip()[:200]
    if term:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(or_(*[
            column.ilike(pattern, escape="\\") for column in _CONTACT_SEARCH_COLUMNS
        ]))
    if eligible:
        from app.services.campaign import BLOCKED_STATUSES
        conditions.append(Contact.opted_out.is_(False))
        conditions.append(Contact.status.notin_(BLOCKED_STATUSES))
    return conditions


def list_paged_contacts(owner_id, q="", status="All", sort="recent", page=1, page_size=25, eligible=False):
    page = max(1, int(page))
    page_size = min(max(1, int(page_size)), 100)
    base = [_contact_owner(owner_id), *_contact_conditions(q, eligible)]
    conditions = list(base)
    if status and status != "All":
        conditions.append(Contact.status == status)
    order = _CONTACT_SORT_ORDERS.get(sort, _CONTACT_SORT_ORDERS["recent"])
    with SessionLocal() as db:
        total = db.scalar(select(func.count(Contact.id)).where(*conditions)) or 0
        unfiltered_total = db.scalar(
            select(func.count(Contact.id)).where(_contact_owner(owner_id))
        ) or 0
        grouped = dict(db.execute(
            select(Contact.status, func.count(Contact.id)).where(*base).group_by(Contact.status)
        ).all())
        rows = list(db.scalars(
            select(Contact)
            .where(*conditions)
            .order_by(*order)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all())
    status_counts = {"All": sum(grouped.values())}
    status_counts.update({value: grouped.get(value, 0) for value in sorted(CONTACT_STATUSES)})
    for value, count in grouped.items():
        status_counts.setdefault(value, count)
    return {
        "rows": rows,
        "total": total,
        "unfiltered_total": unfiltered_total,
        "page": page,
        "page_size": page_size,
        "page_count": (total + page_size - 1) // page_size,
        "status_counts": status_counts,
    }


def lookup_contacts(ids, owner_id):
    requested = list(dict.fromkeys(int(value) for value in list(ids or [])[:200]))
    if not requested:
        return []
    with SessionLocal() as db:
        rows = list(db.scalars(
            select(Contact).where(_contact_owner(owner_id), Contact.id.in_(requested))
        ).all())
    by_id = {row.id: row for row in rows}
    return [by_id[value] for value in requested if value in by_id]


def recent_contacts(owner_id, limit=15):
    limit = min(max(int(limit), 1), 50)
    with SessionLocal() as db:
        return list(db.scalars(
            select(Contact)
            .where(_contact_owner(owner_id))
            .order_by(Contact.updated_at.desc(), Contact.id.desc())
            .limit(limit)
        ).all())


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
        if job_id is not None:
            job = db.get(JobPosting, int(job_id))
            if not job or job.contact_id != contact.id or not _job_owned(job, owner_id):
                raise ValueError("Job not found")
        draft = EmailDraft(
            contact_id=contact.id, subject=subject.strip(), body=body.strip(),
            status="DRAFT", job_id=job_id,
            owner_id=int(owner_id) if owner_id is not None else contact.owner_id,
        )
        db.add(draft)
        db.flush()
        contact.status = "DRAFTED"
        draft_id = draft.id
        company_name = contact.company_name
        db.commit()
    audit.log(
        owner_id, "DRAFT_CREATED",
        f"Created draft for {company_name}: {subject.strip()[:200]}",
        contact_id=contact_id,
    )
    return draft_id


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
            .where(_owned_contact(EmailDraft, owner_id))
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
        followup_event = db.scalar(
            select(OutreachEvent.id).where(OutreachEvent.followup_draft_id == draft.id)
        )
        if draft.contact.opted_out or draft.contact.status in {
            "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED",
        }:
            raise ValueError("This contact is no longer eligible for outreach")
        if draft.contact.status == "SENT" and not followup_event:
            raise ValueError("This contact is no longer eligible for outreach")
        draft.status = "APPROVED"
        draft.approved_at = datetime.now(timezone.utc)
        contact_id = draft.contact_id
        company_name = draft.contact.company_name
        db.commit()
    audit.log(
        owner_id, "DRAFT_APPROVED",
        f"Approved draft for {company_name}: {draft.subject[:200]}",
        contact_id=contact_id,
    )


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
        followup_event = db.scalar(
            select(OutreachEvent).where(OutreachEvent.followup_draft_id == draft.id)
        )
        now = datetime.now(timezone.utc)
        due = None if followup_event else now + timedelta(days=followup_days or settings.followup_default_days)
        if followup_event:
            followup_event.completed = True
        event = OutreachEvent(
            contact_id=contact.id, draft_id=draft.id, event_type="SENT",
            message_id=message_id or "", thread_id=thread_id or "",
            details="Gmail API accepted send request", occurred_at=now, followup_due_at=due,
            owner_id=int(owner_id) if owner_id is not None else (draft.owner_id or contact.owner_id),
        )
        db.add(event)
        draft.status = "SENT"
        contact.status = "SENT"
        contact_id = contact.id
        company_name = contact.company_name
        subject = draft.subject
        db.commit()
    audit.log(
        owner_id, "EMAIL_SENT",
        f"Sent to {company_name}: {subject[:200]}",
        contact_id=contact_id,
    )


def record_failed(draft_id, error, owner_id=None):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        if draft and (owner_id is None or draft.owner_id == int(owner_id)):
            db.add(OutreachEvent(
                contact_id=draft.contact_id, draft_id=draft.id, event_type="FAILED",
                details=str(error)[:2000], owner_id=draft.owner_id or draft.contact.owner_id,
            ))
            draft.status = "FAILED"
            draft.contact.status = "FAILED"
            contact_id = draft.contact_id
            company_name = draft.contact.company_name
            db.commit()
        else:
            contact_id = None
            company_name = ""
    audit.log(
        owner_id, "EMAIL_FAILED",
        f"Send failed for {company_name}: {str(error)[:500]}",
        contact_id=contact_id,
    )


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
        if status in {"REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}:
            for event in db.scalars(select(OutreachEvent).where(
                OutreachEvent.contact_id == contact.id,
                OutreachEvent.event_type == "SENT",
                OutreachEvent.completed.is_(False),
            )).all():
                event.completed = True
        db.add(OutreachEvent(
            contact_id=contact.id, event_type=status, details="Status updated manually",
            owner_id=contact.owner_id,
        ))
        company_name = contact.company_name
        owner = contact.owner_id
        saved_contact_id = contact.id
        db.commit()
    audit.log(
        owner, "CONTACT_STATUS_CHANGED",
        f"{company_name} marked {status}.",
        contact_id=saved_contact_id,
    )


def unsubscribe_contact(token):
    payload = security.read_unsubscribe_token(token)
    if not payload:
        return {"ok": False, "message": "This unsubscribe link is invalid or expired."}
    with SessionLocal() as db:
        contact = db.get(Contact, payload["contact_id"])
        if not contact or (contact.owner_id or 0) != payload["owner_id"]:
            return {"ok": False, "message": "This unsubscribe link is no longer valid."}
        already_opted_out = bool(contact.opted_out)
        contact.opted_out = True
        contact.status = "OPTED_OUT"
        for event in db.scalars(select(OutreachEvent).where(
            OutreachEvent.contact_id == contact.id,
            OutreachEvent.event_type == "SENT",
            OutreachEvent.completed.is_(False),
        )).all():
            event.completed = True
        if not already_opted_out:
            db.add(OutreachEvent(
                contact_id=contact.id,
                event_type="OPTED_OUT",
                details="Unsubscribe link used",
                owner_id=contact.owner_id,
            ))
        company_name = contact.company_name
        email = contact.email
        owner = contact.owner_id
        contact_id = contact.id
        db.commit()
    audit.log(
        owner, "UNSUBSCRIBE_LINK_USED",
        f"{company_name} ({email}) opted out via unsubscribe link.",
        contact_id=contact_id,
    )
    return {
        "ok": True,
        "already_opted_out": already_opted_out,
        "company_name": company_name,
        "email": email,
    }


def _as_utc(value):
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def get_followups(include_completed=False, owner_id=None):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        stmt = (
            select(OutreachEvent)
            .options(joinedload(OutreachEvent.contact))
            .where(OutreachEvent.event_type == "SENT")
            .where(_owned(OutreachEvent, owner_id))
            .where(_owned_contact(OutreachEvent, owner_id))
        )
        if not include_completed:
            stmt = stmt.where(OutreachEvent.completed.is_(False))
        stmt = stmt.order_by(OutreachEvent.followup_due_at.asc())
        rows = list(db.scalars(stmt).all())
        due = [r for r in rows if _as_utc(r.followup_due_at) and _as_utc(r.followup_due_at) <= now]
        upcoming = [r for r in rows if _as_utc(r.followup_due_at) and _as_utc(r.followup_due_at) > now]
        return due + upcoming


def complete_followup(event_id, outcome="Reminder reviewed", owner_id=None):
    with SessionLocal() as db:
        event = db.get(OutreachEvent, int(event_id))
        if not event or (owner_id is not None and (
            event.owner_id != int(owner_id)
            or not event.contact
            or event.contact.owner_id != int(owner_id)
        )):
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
        draft_contacts = _owned_contact(EmailDraft, owner_id)
        events = _owned(OutreachEvent, owner_id)
        event_contacts = _owned_contact(OutreachEvent, owner_id)
        return {
            "contacts": count(select(func.count(Contact.id)).where(contacts)),
            "sent": count(select(func.count(OutreachEvent.id)).where(events, event_contacts, OutreachEvent.event_type == "SENT")),
            "opened": None,
            "replies": count(select(func.count(Contact.id)).where(contacts, Contact.status == "REPLIED")),
            "opted_out": count(select(func.count(Contact.id)).where(contacts, Contact.opted_out.is_(True))),
            "pending": count(select(func.count(Contact.id)).where(contacts, Contact.status == "PENDING")),
            "approved": count(select(func.count(EmailDraft.id)).where(drafts, draft_contacts, EmailDraft.status == "APPROVED")),
            "failed": count(select(func.count(OutreachEvent.id)).where(events, event_contacts, OutreachEvent.event_type == "FAILED")),
        }


def sent_today_count(owner_id=None):
    local_now = datetime.now(ZoneInfo(settings.timezone))
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    with SessionLocal() as db:
        return db.scalar(
            select(func.count(OutreachEvent.id)).where(
                _owned(OutreachEvent, owner_id),
                _owned_contact(OutreachEvent, owner_id),
                OutreachEvent.event_type == "SENT",
                OutreachEvent.occurred_at >= start,
            )
        ) or 0


def latest_sent_at(owner_id=None):
    with SessionLocal() as db:
        stmt = select(OutreachEvent).where(OutreachEvent.event_type == "SENT")
        if owner_id is not None:
            stmt = stmt.where(OutreachEvent.owner_id == int(owner_id))
        event = db.scalar(stmt.order_by(OutreachEvent.occurred_at.desc()).limit(1))
        return _as_utc(event.occurred_at) if event else None


def followup_counts(owner_id=None, now=None):
    now = now or datetime.now(timezone.utc)
    with SessionLocal() as db:
        rows = list(db.scalars(
            select(OutreachEvent)
            .where(
                OutreachEvent.event_type == "SENT",
                OutreachEvent.completed.is_(False),
                OutreachEvent.followup_due_at.is_not(None),
                _owned(OutreachEvent, owner_id),
                _owned_contact(OutreachEvent, owner_id),
            )
        ).all())
        due = sum(1 for row in rows if _as_utc(row.followup_due_at) <= now)
        return {
            "due": due,
            "upcoming": len(rows) - due,
            "drafts_ready": sum(1 for row in rows if row.followup_draft_id),
            "open": len(rows),
        }


OPT_OUT_PATTERNS = (
    "unsubscribe", "opt out", "opt-out", "remove me", "remove my",
    "do not contact", "don't contact", "stop emailing", "stop contacting",
    "take me off", "no longer interested", "not interested anymore",
)


def _looks_like_opt_out(text):
    normalized = str(text or "").lower()
    return any(pattern in normalized for pattern in OPT_OUT_PATTERNS)


def sync_inbox_best_effort(gmail, owner_id=None):
    """Best-effort inbox matching for replies and opt-outs. Verify matches manually."""
    messages = gmail.list_recent_inbox(100)
    matched = replies = opt_outs = 0
    audit_entries = []
    with SessionLocal() as db:
        stmt = select(Contact).where(Contact.status == "SENT", _owned(Contact, owner_id))
        by_email = {c.email.lower(): c for c in db.scalars(stmt).all()}
        for item in messages:
            try:
                msg = gmail.get_message(item["id"])
                headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                sender = headers.get("from", "").lower()
                contact = next((c for addr, c in by_email.items() if addr in sender), None)
                if not contact or contact.status != "SENT":
                    continue
                text = " ".join([
                    headers.get("subject", ""),
                    msg.get("snippet", ""),
                ])
                if _looks_like_opt_out(text):
                    contact.status = "OPTED_OUT"
                    contact.opted_out = True
                    event_type = "OPTED_OUT"
                    details = "Opt-out detected in reply; verify in Gmail"
                    opt_outs += 1
                else:
                    contact.status = "REPLIED"
                    event_type = "REPLIED"
                    details = "Potential reply matched by sender; verify in Gmail"
                    replies += 1
                for event in db.scalars(select(OutreachEvent).where(
                    OutreachEvent.contact_id == contact.id,
                    OutreachEvent.event_type == "SENT",
                    OutreachEvent.completed.is_(False),
                )).all():
                    event.completed = True
                db.add(OutreachEvent(
                    contact_id=contact.id, event_type=event_type,
                    message_id=item["id"], thread_id=msg.get("threadId", ""),
                    details=details, owner_id=contact.owner_id,
                ))
                audit_entries.append((
                    contact.owner_id,
                    "OPT_OUT_DETECTED" if event_type == "OPTED_OUT" else "REPLY_MATCHED",
                    f"{contact.company_name}: {details}",
                    contact.id,
                ))
                matched += 1
            except Exception:
                continue
        db.commit()
    for owner, action, details, contact_id in audit_entries:
        audit.log(owner, action, details, contact_id=contact_id)
    return {"matched": matched, "replies": replies, "opt_outs": opt_outs}


def sync_replies_best_effort(gmail, owner_id=None):
    """Backward-compatible wrapper returning the number of matched messages."""
    return sync_inbox_best_effort(gmail, owner_id)["matched"]


def get_jobs(contact_id, owner_id=None):
    with SessionLocal() as db:
        contact = db.get(Contact, int(contact_id))
        if not contact or (owner_id is not None and contact.owner_id != int(owner_id)):
            return []
        stmt = (
            select(JobPosting)
            .where(JobPosting.contact_id == int(contact_id))
            .where(_owned(JobPosting, owner_id))
            .where(_owned_job(JobPosting, owner_id))
            .order_by(JobPosting.created_at.desc())
        )
        return list(db.scalars(stmt).all())


def get_job(job_id, owner_id=None):
    with SessionLocal() as db:
        job = db.get(JobPosting, int(job_id))
        if job and not _job_owned(job, owner_id):
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
        if not job or not _job_owned(job, owner_id):
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

def _job_payload(job):
    contact = job.contact
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
        "verified_at": _as_utc(job.verified_at).isoformat() if job.verified_at else None,
        "posted_at": _as_utc(job.posted_at).isoformat() if getattr(job, "posted_at", None) else None,
        "salary_min": getattr(job, "salary_min", None),
        "salary_max": getattr(job, "salary_max", None),
        "salary_currency": getattr(job, "salary_currency", ""),
        "salary_period": getattr(job, "salary_period", ""),
        "experience_level": getattr(job, "experience_level", ""),
        "employment_type": getattr(job, "employment_type", ""),
        "remote": bool(getattr(job, "remote", False)),
        "fingerprint": getattr(job, "fingerprint", None),
        "first_seen_at": _as_utc(job.first_seen_at).isoformat() if getattr(job, "first_seen_at", None) else None,
        "last_seen_at": _as_utc(job.last_seen_at).isoformat() if getattr(job, "last_seen_at", None) else None,
        "created_at": _as_utc(job.created_at).isoformat() if job.created_at else None,
        "contact_email": contact.email if contact else "",
        "contact_role": contact.role if contact else "",
    }


def _csv_filters(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def list_all_jobs(
    owner_id,
    query="",
    company="",
    location="",
    active=None,
    page=1,
    page_size=50,
    skills="",
    experience="",
    salary_min=None,
    fresher_only=False,
    sources="",
    posted_within_days=None,
    sort="newest",
):
    page = max(1, int(page))
    page_size = min(max(1, int(page_size)), 100)
    skill_terms = _csv_filters(skills)
    experience_terms = [item.upper() for item in _csv_filters(experience)]
    source_terms = _csv_filters(sources)
    with SessionLocal() as db:
        conditions = [_owned(JobPosting, owner_id), _owned_job(JobPosting, owner_id)]
        if query:
            term = f"%{query.strip()}%"
            conditions.append(or_(
                JobPosting.title.ilike(term),
                JobPosting.company_name.ilike(term),
                JobPosting.description.ilike(term),
            ))
        if company:
            conditions.append(JobPosting.company_name.ilike(f"%{company.strip()}%"))
        if location:
            term = f"%{location.strip()}%"
            conditions.append(or_(JobPosting.location.ilike(term), JobPosting.remote.is_(True)))
        if active is not None:
            conditions.append(JobPosting.active.is_(bool(active)))
        if skill_terms:
            conditions.append(or_(*[
                or_(
                    JobPosting.title.ilike(f"%{skill}%"),
                    JobPosting.description.ilike(f"%{skill}%"),
                )
                for skill in skill_terms
            ]))
        if experience_terms:
            levels = []
            for term in experience_terms:
                levels.extend(term.split())
            levels = list(dict.fromkeys(levels))
            experience_conditions = [JobPosting.experience_level.ilike(f"%{level}%") for level in levels if level != "ALL"]
            if "ENTRY" in levels:
                experience_conditions.extend([
                    JobPosting.experience_level.ilike("%FRESHER%"),
                    JobPosting.title.ilike("%junior%"),
                    JobPosting.title.ilike("%entry%"),
                ])
            if experience_conditions:
                conditions.append(or_(*experience_conditions))
        if salary_min:
            floor = int(salary_min)
            conditions.append(or_(
                JobPosting.salary_min >= floor,
                JobPosting.salary_max >= floor,
            ))
        if fresher_only:
            conditions.append(or_(
                JobPosting.experience_level.in_(["FRESHER", "ENTRY"]),
                JobPosting.title.ilike("%fresher%"),
                JobPosting.title.ilike("%junior%"),
                JobPosting.title.ilike("%entry%"),
                JobPosting.title.ilike("%graduate%"),
            ))
        if source_terms:
            conditions.append(JobPosting.source.in_(source_terms))
        if posted_within_days:
            cutoff = datetime.now(timezone.utc) - timedelta(days=int(posted_within_days))
            conditions.append(or_(
                JobPosting.posted_at >= cutoff,
                and_(JobPosting.posted_at.is_(None), JobPosting.created_at >= cutoff),
            ))
        total = db.scalar(select(func.count(JobPosting.id)).where(*conditions)) or 0
        order = [JobPosting.active.desc()]
        if sort == "match":
            order.extend([JobPosting.match_score.desc().nullslast(), JobPosting.created_at.desc()])
        elif sort == "salary":
            order.extend([JobPosting.salary_max.desc().nullslast(), JobPosting.created_at.desc()])
        elif sort == "posted":
            order.extend([JobPosting.posted_at.desc().nullslast(), JobPosting.created_at.desc()])
        else:
            order.extend([JobPosting.created_at.desc(), JobPosting.id.desc()])
        rows = list(db.scalars(
            select(JobPosting)
            .options(joinedload(JobPosting.contact))
            .where(*conditions)
            .order_by(*order)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all())
        companies = [
            value for value in db.scalars(
                select(JobPosting.company_name)
                .where(_owned(JobPosting, owner_id), _owned_job(JobPosting, owner_id))
                .distinct()
                .order_by(JobPosting.company_name)
            ).all()
            if value
        ]
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "page_count": (total + page_size - 1) // page_size,
            "companies": companies,
            "jobs": [_job_payload(job) for job in rows],
        }


def analytics_summary(owner_id, days=30):
    days = min(max(int(days), 7), 90)
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days - 1)
    with SessionLocal() as db:
        owned_contacts = _owned(Contact, owner_id)
        contact_totals = db.execute(
            select(
                func.count(Contact.id),
                func.count().filter(Contact.status == "REPLIED"),
                func.count().filter(Contact.opted_out.is_(True)),
            ).where(owned_contacts)
        ).one()
        status_counts = dict(db.execute(
            select(Contact.status, func.count(Contact.id))
            .where(owned_contacts)
            .group_by(Contact.status)
            .order_by(Contact.status)
        ).all())
        drafts = list(db.scalars(
            select(EmailDraft)
            .options(joinedload(EmailDraft.contact))
            .where(_owned(EmailDraft, owner_id), _owned_contact(EmailDraft, owner_id))
        ).all())
        jobs = list(db.scalars(
            select(JobPosting)
            .options(joinedload(JobPosting.contact))
            .where(_owned(JobPosting, owner_id), _owned_job(JobPosting, owner_id))
            .order_by(JobPosting.created_at.desc())
        ).all())
        events = list(db.scalars(
            select(OutreachEvent)
            .options(joinedload(OutreachEvent.contact))
            .where(
                _owned(OutreachEvent, owner_id),
                _owned_contact(OutreachEvent, owner_id),
                OutreachEvent.occurred_at >= start,
            )
        ).all())
        open_followups = list(db.scalars(
            select(OutreachEvent).where(
                OutreachEvent.event_type == "SENT",
                OutreachEvent.completed.is_(False),
                OutreachEvent.followup_due_at.is_not(None),
                _owned(OutreachEvent, owner_id),
                _owned_contact(OutreachEvent, owner_id),
            )
        ).all())

    buckets = {}
    for offset in range(days):
        key = (start + timedelta(days=offset)).date().isoformat()
        buckets[key] = {"date": key, "sent": 0, "replies": 0, "opt_outs": 0, "failed": 0, "prepared": 0}

    for draft in drafts:
        created = _as_utc(draft.created_at)
        if created and created >= start:
            key = created.date().isoformat()
            if key in buckets:
                buckets[key]["prepared"] += 1

    company_stats = {}
    for event in events:
        occurred = _as_utc(event.occurred_at)
        if not occurred:
            continue
        key = occurred.date().isoformat()
        bucket = buckets.get(key)
        if bucket is not None:
            if event.event_type == "SENT":
                bucket["sent"] += 1
            elif event.event_type == "REPLIED":
                bucket["replies"] += 1
            elif event.event_type == "OPTED_OUT":
                bucket["opt_outs"] += 1
            elif event.event_type == "FAILED":
                bucket["failed"] += 1
        contact = event.contact
        if contact:
            row = company_stats.setdefault(contact.company_name, {"company": contact.company_name, "sent": 0, "replies": 0})
            if event.event_type == "SENT":
                row["sent"] += 1
            elif event.event_type == "REPLIED":
                row["replies"] += 1

    due = sum(1 for item in open_followups if _as_utc(item.followup_due_at) and _as_utc(item.followup_due_at) <= now)
    draft_counts = {}
    for draft in drafts:
        draft_counts[draft.status] = draft_counts.get(draft.status, 0) + 1

    return {
        "days": days,
        "series": list(buckets.values()),
        "totals": {
            "contacts": contact_totals[0],
            "jobs": len(jobs),
            "active_jobs": sum(1 for job in jobs if job.active),
            "verified_jobs": sum(1 for job in jobs if job.verified_at),
            "drafts": len(drafts),
            "approved": draft_counts.get("APPROVED", 0),
            "sent": sum(1 for event in events if event.event_type == "SENT"),
            "replies": contact_totals[1],
            "opted_out": contact_totals[2],
            "followups_due": due,
            "followups_upcoming": len(open_followups) - due,
        },
        "pipeline": status_counts,
        "draft_pipeline": draft_counts,
        "companies": sorted(company_stats.values(), key=lambda item: (item["sent"], item["replies"]), reverse=True)[:8],
        "recent_jobs": [_job_payload(job) for job in jobs[:8]],
    }


def inbox_threads(owner_id, limit=50):
    limit = min(max(int(limit), 1), 100)
    with SessionLocal() as db:
        contacts = list(db.scalars(
            select(Contact)
            .where(_owned(Contact, owner_id))
            .order_by(Contact.updated_at.desc())
            .limit(limit)
        ).all())
        result = []
        for contact in contacts:
            events = list(db.scalars(
                select(OutreachEvent)
                .where(OutreachEvent.contact_id == contact.id, _owned(OutreachEvent, owner_id))
                .order_by(OutreachEvent.occurred_at.desc(), OutreachEvent.id.desc())
                .limit(20)
            ).all())
            drafts = list(db.scalars(
                select(EmailDraft)
                .where(EmailDraft.contact_id == contact.id, _owned(EmailDraft, owner_id))
                .order_by(EmailDraft.created_at.desc())
                .limit(5)
            ).all())
            if not events and contact.status not in {"SENT", "REPLIED", "OPTED_OUT"}:
                continue
            last = events[0] if events else None
            last_sent = next((event for event in events if event.event_type == "SENT"), None)
            thread_id = next((event.thread_id for event in events if event.thread_id), "")
            result.append({
                "contact": {
                    "id": contact.id,
                    "company_name": contact.company_name,
                    "email": contact.email,
                    "hr_name": contact.hr_name,
                    "role": contact.role,
                    "location": contact.location,
                    "website": getattr(contact, "website", ""),
                    "status": contact.status,
                    "opted_out": contact.opted_out,
                    "updated_at": _as_utc(contact.updated_at).isoformat() if contact.updated_at else None,
                },
                "last_event_type": last.event_type if last else None,
                "last_event_at": _as_utc(last.occurred_at).isoformat() if last and last.occurred_at else None,
                "last_event_details": last.details if last else "",
                "last_subject": last_sent.draft.subject if last_sent and last_sent.draft else (drafts[0].subject if drafts else ""),
                "thread_id": thread_id,
                "message_id": last.message_id if last else "",
                "reply_detected": contact.status == "REPLIED",
                "history": [
                    {
                        "id": event.id,
                        "type": event.event_type,
                        "details": event.details,
                        "occurred_at": _as_utc(event.occurred_at).isoformat() if event.occurred_at else None,
                    }
                    for event in events
                ],
                "drafts": [
                    {
                        "id": draft.id,
                        "subject": draft.subject,
                        "status": draft.status,
                        "created_at": _as_utc(draft.created_at).isoformat() if draft.created_at else None,
                    }
                    for draft in drafts
                ],
            })
        return result
