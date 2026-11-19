import logging
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from googleapiclient.errors import HttpError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.config import settings
from app.db.models import Campaign, CampaignContact, EmailDraft, OutreachEvent, User
from app.db.session import SessionLocal
from app.services import audit, campaign as campaign_service
from app.services import compliance, gmail_tokens, profile_service
from app.services.gmail_service import GmailService
from app.services.outreach import latest_sent_at, mark_sent, sent_today_count


logger = logging.getLogger(__name__)
BLOCKED_STATUSES = {"SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}


def _as_utc(value):
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _result(status, sent=0, retried=0, failed=0, message=""):
    return {
        "status": status,
        "sent": sent,
        "retried": retried,
        "failed": failed,
        "message": message,
    }


def _resume_tempfile(owner_id):
    resume = profile_service.get_resume(owner_id)
    if not resume:
        return None
    temp = tempfile.NamedTemporaryFile(prefix="jobreach-auto-resume-", suffix=".pdf", delete=False)
    with temp:
        temp.write(resume.content)
    return Path(temp.name)


def _sender_name(owner_id):
    return (profile_service.profile_dict(owner_id) or {}).get("full_name")


def _is_retryable(exc):
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return True
    if isinstance(exc, HttpError):
        return getattr(exc.resp, "status", None) in {403, 408, 429, 500, 502, 503, 504}
    return False


def _handle_failure(entry_id, owner_id, exc, now):
    retryable = _is_retryable(exc)
    with SessionLocal() as db:
        entry = db.scalar(
            select(CampaignContact)
            .join(Campaign)
            .where(
                CampaignContact.id == int(entry_id),
                Campaign.user_id == int(owner_id),
                CampaignContact.state == "SENDING",
            )
        )
        if not entry:
            return "idle"
        entry.attempts += 1
        entry.last_attempt_at = now
        entry.error = str(exc)[:500]
        entry.reserved_at = None
        contact_id = entry.contact_id
        attempts = entry.attempts
        campaign = db.get(Campaign, entry.campaign_id)
        if retryable and entry.attempts < settings.auto_send_max_attempts:
            entry.state = "QUEUED"
            delay = settings.auto_send_retry_backoff_seconds * entry.attempts
            entry.scheduled_at = now + timedelta(seconds=delay)
            db.add(OutreachEvent(
                contact_id=entry.contact_id,
                draft_id=entry.draft_id,
                event_type="SEND_RETRY",
                details=f"Auto-send retry {entry.attempts} scheduled after: {str(exc)[:1500]}",
                owner_id=int(owner_id),
            ))
            db.commit()
            audit.log(
                owner_id, "EMAIL_RETRY_SCHEDULED",
                f"Automated send retry {entry.attempts} scheduled: {str(exc)[:500]}",
                contact_id=contact_id,
            )
            return "retried"
        entry.state = "FAILED"
        entry.scheduled_at = None
        if entry.draft_id:
            draft = db.get(EmailDraft, entry.draft_id)
            if draft:
                draft.status = "FAILED"
                draft.contact.status = "FAILED"
        if campaign:
            campaign.status = "PAUSED"
            campaign.paused_at = now
            campaign.last_error = f"Paused after a send failure: {str(exc)[:200]}"
        db.add(OutreachEvent(
            contact_id=entry.contact_id,
            draft_id=entry.draft_id,
            event_type="FAILED",
            details=str(exc)[:2000],
            owner_id=int(owner_id),
        ))
        db.commit()
    audit.log(
        owner_id, "EMAIL_FAILED",
        f"Automated send failed after {attempts} attempt(s): {str(exc)[:500]}",
        contact_id=contact_id,
    )
    return "failed"


def pause_user_campaigns(owner_id, reason, now=None):
    now = now or datetime.now(timezone.utc)
    with SessionLocal() as db:
        campaigns = list(db.scalars(
            select(Campaign).where(Campaign.user_id == int(owner_id), Campaign.status == "RUNNING")
        ).all())
        for campaign in campaigns:
            campaign.status = "PAUSED"
            campaign.paused_at = now
            campaign.last_error = reason
        db.commit()
        return len(campaigns)


def start_campaign(campaign_id, owner_id):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        campaign = db.get(Campaign, int(campaign_id))
        if not campaign or campaign.user_id != int(owner_id):
            raise ValueError("Campaign not found.")
        user = db.get(User, int(owner_id))
        if compliance.dry_run_enabled(user):
            raise ValueError("Dry-run is enabled. Turn it off in Settings before starting automated sending.")
        if campaign.status == "RUNNING":
            return {"status": "RUNNING", "message": "Automated sending is already running."}
        if campaign.status == "COMPLETED":
            raise ValueError("This campaign is already complete.")
        queued = db.scalar(
            select(func.count(CampaignContact.id)).where(
                CampaignContact.campaign_id == campaign.id,
                CampaignContact.state == "QUEUED",
            )
        ) or 0
        if not queued:
            raise ValueError("Queue at least one approved draft before starting automated sending.")
        if not gmail_tokens.connection_status(owner_id)["connected"]:
            raise ValueError("Connect Gmail before starting automated sending.")
        if not profile_service.get_resume(owner_id):
            raise ValueError("Upload a PDF resume before starting automated sending.")
        campaign.status = "RUNNING"
        campaign.started_at = now
        campaign.paused_at = None
        campaign.last_error = ""
        db.commit()
    audit.log(
        owner_id, "CAMPAIGN_STARTED",
        f"Automated sending started for {queued} queued draft(s).",
    )
    return {"status": "RUNNING", "message": f"Automated sending started for {queued} queued draft(s)."}


def pause_campaign(campaign_id, owner_id):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        campaign = db.get(Campaign, int(campaign_id))
        if not campaign or campaign.user_id != int(owner_id):
            raise ValueError("Campaign not found.")
        if campaign.status != "RUNNING":
            return {"status": campaign.status, "message": "Campaign is not currently running."}
        campaign.status = "PAUSED"
        campaign.paused_at = now
        campaign.last_error = "Paused manually."
        db.commit()
    audit.log(owner_id, "CAMPAIGN_PAUSED", "Automated sending paused manually.")
    return {"status": "PAUSED", "message": "Automated sending paused."}


def _gmail_send_exists(owner_id, recipient, subject, since):
    return GmailService(owner_id).connect().find_sent_message(recipient, subject, since)


def _finalize_sent(draft_id, owner_id, now, message_id="", thread_id=""):
    with SessionLocal() as db:
        draft = db.get(EmailDraft, int(draft_id))
        already_sent = bool(draft and draft.status == "SENT")
    if not already_sent:
        mark_sent(draft_id, message_id, thread_id, owner_id=owner_id)
    campaign_service.finalize_send(draft_id, owner_id, now=now)


def reconcile_stale_sending(owner_id, now=None, reconcile=None):
    """Recover SENDING entries whose send lease has expired.

    ``reconcile`` is an optional callable
    ``(draft_id, recipient, subject, reserved_at) -> bool | None``. When it
    returns ``None``, or Gmail cannot be checked, the entry stays SENDING and
    the campaign is paused for manual verification instead of being retried.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=settings.auto_send_send_lease_seconds)
    with SessionLocal() as db:
        entries = list(db.scalars(
            select(CampaignContact)
            .join(Campaign)
            .options(joinedload(CampaignContact.contact), joinedload(CampaignContact.draft))
            .where(
                CampaignContact.state == "SENDING",
                Campaign.status == "RUNNING",
                or_(
                    CampaignContact.reserved_at.is_(None),
                    CampaignContact.reserved_at <= cutoff,
                ),
            )
        ).all())
        snapshots = [
            (entry.draft_id, entry.contact.email, entry.draft.subject, entry.reserved_at)
            for entry in entries
            if entry.contact and entry.draft
        ]

    reconciled = 0
    for draft_id, recipient, subject, reserved_at in snapshots:
        if reconcile is not None:
            try:
                result = reconcile(draft_id, recipient, subject, reserved_at)
                sent = None if result is None else bool(result)
            except Exception:
                sent = None
        else:
            try:
                sent = _gmail_send_exists(owner_id, recipient, subject, reserved_at or cutoff)
            except Exception:
                logger.exception("Could not verify stale send for draft %s", draft_id)
                sent = None
        if sent is None:
            pause_user_campaigns(
                owner_id,
                "A send is in an uncertain state. Check Gmail Sent before resuming the campaign.",
                now,
            )
            continue
        if sent is True:
            _finalize_sent(draft_id, owner_id, now)
        else:
            campaign_service.release_send_claim(draft_id, owner_id, "QUEUED", now=now)
        reconciled += 1
    return reconciled


def run_once(now=None):
    now = now or datetime.now(timezone.utc)
    with SessionLocal() as db:
        owner_ids = list(db.scalars(
            select(Campaign.user_id).where(Campaign.status == "RUNNING")
        ).all())
    for owner_id in owner_ids:
        try:
            reconcile_stale_sending(owner_id, now=now)
        except Exception:
            logger.exception("Could not reconcile stale SENDING entries for user %s", owner_id)

    lease_cutoff = now - timedelta(seconds=settings.auto_send_send_lease_seconds)
    with SessionLocal() as db:
        campaigns = list(db.scalars(
            select(Campaign)
            .where(Campaign.status == "RUNNING")
            .order_by(Campaign.started_at.asc(), Campaign.id.asc())
        ).all())
        if not campaigns:
            return _result("idle")

        candidates = []
        changed = False
        for campaign in campaigns:
            user = db.get(User, campaign.user_id)
            if compliance.dry_run_enabled(user):
                campaign.status = "PAUSED"
                campaign.paused_at = now
                campaign.last_error = "Dry-run is enabled. Turn it off in Settings to resume automated sending."
                changed = True
                continue
            stale_sending = db.scalar(
                select(func.count(CampaignContact.id)).where(
                    CampaignContact.campaign_id == campaign.id,
                    CampaignContact.state == "SENDING",
                    or_(
                        CampaignContact.reserved_at.is_(None),
                        CampaignContact.reserved_at <= lease_cutoff,
                    ),
                )
            ) or 0
            if stale_sending:
                campaign.status = "PAUSED"
                campaign.paused_at = now
                campaign.last_error = "An automated send is in an uncertain state. Check Gmail Sent before resuming."
                changed = True
                continue
            active_sending = db.scalar(
                select(func.count(CampaignContact.id)).where(
                    CampaignContact.campaign_id == campaign.id,
                    CampaignContact.state == "SENDING",
                )
            ) or 0
            if active_sending:
                continue
            entries = list(db.scalars(
                select(CampaignContact)
                .options(joinedload(CampaignContact.contact), joinedload(CampaignContact.draft))
                .where(CampaignContact.campaign_id == campaign.id, CampaignContact.state == "QUEUED")
                .order_by(CampaignContact.id)
            ).all())
            if not entries:
                failed = db.scalar(
                    select(func.count(CampaignContact.id)).where(
                        CampaignContact.campaign_id == campaign.id,
                        CampaignContact.state == "FAILED",
                    )
                ) or 0
                campaign.status = "COMPLETED"
                if failed:
                    campaign.last_error = f"Finished with {failed} failed draft(s)."
                changed = True
                continue
            invalid = next((entry for entry in entries if not entry.draft or entry.draft.status != "APPROVED"), None)
            if invalid:
                campaign.status = "PAUSED"
                campaign.paused_at = now
                campaign.last_error = "A queued draft is no longer approved. Re-approve it before resuming."
                changed = True
                continue
            for entry in entries:
                if entry.contact.opted_out or entry.contact.status in BLOCKED_STATUSES:
                    entry.state = "FAILED"
                    entry.error = "Contact is no longer eligible for outreach."
                    changed = True
                    continue
                due = not entry.scheduled_at or _as_utc(entry.scheduled_at) <= now
                if due:
                    candidates.append((campaign, entry))
        if changed:
            db.commit()
        if not candidates:
            return _result("waiting")

        candidates.sort(key=lambda pair: (
            _as_utc(pair[0].started_at) or now,
            _as_utc(pair[1].scheduled_at) or now,
            pair[1].id,
        ))
        selected = None
        cap_paused = False
        for campaign, entry in candidates:
            if sent_today_count(campaign.user_id) >= settings.max_emails_per_day:
                pause_user_campaigns(
                    campaign.user_id,
                    "Daily sending cap reached. Resume after the next local day.",
                    now,
                )
                cap_paused = True
                continue
            last_sent = latest_sent_at(campaign.user_id)
            if last_sent and (now - last_sent).total_seconds() < settings.min_seconds_between_emails:
                continue
            selected = (campaign, entry)
            break
        if not selected:
            if cap_paused:
                return _result("daily_cap", message="Daily sending cap reached.")
            return _result("throttled", message="Waiting for the per-user sending interval.")
        campaign, entry = selected
        campaign_id = campaign.id
        entry_id = entry.id
        owner_id = campaign.user_id
        draft_id = entry.draft_id
        email = entry.contact.email
        subject = entry.draft.subject
        body = compliance.with_opt_out(entry.draft.body, entry.contact, owner_id)

    with SessionLocal() as db:
        fresh_campaign = db.get(Campaign, campaign_id)
        fresh_entry = db.get(CampaignContact, entry_id)
        if (
            not fresh_campaign
            or fresh_campaign.status != "RUNNING"
            or not fresh_entry
            or fresh_entry.state != "QUEUED"
            or fresh_entry.contact.opted_out
            or fresh_entry.contact.status in BLOCKED_STATUSES
        ):
            return _result("idle")

    try:
        claimed = campaign_service.claim_for_send(
            draft_id, owner_id, now=now, allowed_states={"QUEUED"}
        )
    except Exception as exc:
        logger.exception("Could not reserve SENDING state for entry %s", entry_id)
        pause_user_campaigns(
            owner_id,
            f"Could not reserve the draft for sending: {exc}. Check the campaign before resuming.",
            now,
        )
        return _result("paused", message=str(exc)[:200])
    if not claimed:
        return _result("idle")

    try:
        resume = _resume_tempfile(owner_id)
    except Exception as exc:
        _handle_failure(entry_id, owner_id, exc, now)
        return _result("failed", failed=1, message=str(exc)[:200])
    if not resume:
        campaign_service.release_send_claim(draft_id, owner_id, "QUEUED", now=now)
        pause_user_campaigns(owner_id, "Upload a PDF resume before automated sending.", now)
        return _result("paused", message="Upload a PDF resume before automated sending.")

    try:
        gmail = GmailService(owner_id).connect()
        response = gmail.send(
            email,
            subject,
            body,
            resume,
            sender_name=_sender_name(owner_id),
        )
    except Exception as exc:
        resume.unlink(missing_ok=True)
        status = _handle_failure(entry_id, owner_id, exc, now)
        return _result(
            status,
            retried=1 if status == "retried" else 0,
            failed=1 if status == "failed" else 0,
            message=str(exc)[:200],
        )
    resume.unlink(missing_ok=True)

    try:
        _finalize_sent(
            draft_id,
            owner_id,
            now,
            message_id=response.get("id", ""),
            thread_id=response.get("threadId", ""),
        )
    except Exception as exc:
        logger.exception("Auto-send was accepted but progress could not be recorded")
        pause_user_campaigns(
            owner_id,
            f"Gmail accepted a send but progress could not be recorded: {exc}. Check Gmail Sent before resuming.",
            now,
        )
        return _result("uncertain", sent=1, message=str(exc)[:200])
    return _result("sent", sent=1)
