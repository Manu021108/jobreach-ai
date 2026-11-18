import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.config import settings
from app.db.models import EmailDraft, OutreachEvent
from app.db.session import SessionLocal
from app.services import profile_service


logger = logging.getLogger(__name__)
_stop_event = threading.Event()
_thread = None
_thread_lock = threading.Lock()


def _followup_subject(original):
    subject = (original.subject if original else "").strip()
    if not subject:
        return "Following up on my earlier message"
    subject = subject if subject.lower().startswith("re:") else f"Re: {subject}"
    return subject[:500]


def _followup_body(contact, profile):
    sender = (profile or {}).get("full_name") or settings.sender_name or "Best regards"
    recipient = contact.hr_name or "Hiring Team"
    role = contact.role or "relevant opportunities"
    return (
        f"Hi {recipient},\n\n"
        f"I wanted to follow up on my earlier note about {role} opportunities at "
        f"{contact.company_name}. I remain interested and would be glad to share any "
        f"additional information.\n\n"
        f"Thank you for your time.\n\n"
        f"Best regards,\n{sender}"
    )


def run_once(now=None, owner_id=None):
    now = now or datetime.now(timezone.utc)
    generated = skipped = 0
    with SessionLocal() as db:
        stmt = (
            select(OutreachEvent)
            .options(joinedload(OutreachEvent.contact), joinedload(OutreachEvent.draft))
            .where(
                OutreachEvent.event_type == "SENT",
                OutreachEvent.completed.is_(False),
                OutreachEvent.followup_due_at.is_not(None),
                OutreachEvent.followup_due_at <= now,
                OutreachEvent.followup_draft_id.is_(None),
            )
            .order_by(OutreachEvent.followup_due_at.asc(), OutreachEvent.id.asc())
            .limit(settings.followup_max_per_run)
        )
        if owner_id is not None:
            stmt = stmt.where(OutreachEvent.owner_id == int(owner_id))
        events = list(db.scalars(stmt).all())
        for event in events:
            contact = event.contact
            if not contact:
                skipped += 1
                continue
            if contact.opted_out or contact.status in {"REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}:
                event.completed = True
                skipped += 1
                continue
            if contact.status != "SENT":
                skipped += 1
                continue
            profile = profile_service.profile_dict(event.owner_id) or {}
            draft = EmailDraft(
                contact_id=contact.id,
                subject=_followup_subject(event.draft),
                body=_followup_body(contact, profile),
                status="DRAFT",
                owner_id=event.owner_id,
            )
            db.add(draft)
            db.flush()
            event.followup_draft_id = draft.id
            db.add(OutreachEvent(
                contact_id=contact.id,
                draft_id=draft.id,
                event_type="FOLLOWUP_DRAFT",
                details="Automatic follow-up draft created; review before sending.",
                owner_id=event.owner_id,
            ))
            generated += 1
        db.commit()
    return {"generated": generated, "skipped": skipped}


def _loop():
    while not _stop_event.is_set():
        try:
            run_once()
        except Exception:
            logger.exception("Follow-up worker failed")
        _stop_event.wait(max(1, settings.followup_poll_seconds))


def start_worker():
    global _thread
    with _thread_lock:
        if _thread and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(target=_loop, name="jobreach-followup-worker", daemon=True)
        _thread.start()


def stop_worker():
    global _thread
    with _thread_lock:
        thread = _thread
        _thread = None
    _stop_event.set()
    if thread:
        thread.join(timeout=5)
