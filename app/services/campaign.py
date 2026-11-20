from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import joinedload

from app.db.models import Campaign, CampaignContact, Contact
from app.db.session import SessionLocal
from app.services.ai_writer import AIWriter
from app.services.outreach import approve_draft, save_draft


BLOCKED_STATUSES = {"SENT", "REPLIED", "OPTED_OUT", "NOT_INTERESTED", "ARCHIVED"}
CLAIMABLE_STATES = {"QUEUED", "APPROVED"}


def _iso(value):
    return value.isoformat() if value else None


def _eligible_contacts(db, owner_id, contact_ids):
    ids = sorted({int(value) for value in contact_ids})
    if not ids:
        return []
    contacts = list(db.scalars(
        select(Contact).where(Contact.owner_id == int(owner_id), Contact.id.in_(ids))
    ).all())
    return [
        contact for contact in contacts
        if not contact.opted_out and contact.status not in BLOCKED_STATUSES
    ]


def _campaign_entry_dict(entry):
    draft = entry.draft
    contact = entry.contact
    return {
        "id": entry.id,
        "contact_id": entry.contact_id,
        "draft_id": entry.draft_id,
        "state": entry.state,
        "error": entry.error,
        "attempts": entry.attempts,
        "scheduled_at": _iso(entry.scheduled_at),
        "last_attempt_at": _iso(entry.last_attempt_at),
        "sent_at": _iso(entry.sent_at),
        "company_name": contact.company_name if contact else "",
        "email": contact.email if contact else "",
        "subject": draft.subject if draft else "",
        "draft_status": draft.status if draft else None,
    }


def list_campaigns(owner_id):
    with SessionLocal() as db:
        campaigns = list(db.scalars(
            select(Campaign).where(Campaign.user_id == int(owner_id)).order_by(Campaign.created_at.desc())
        ).all())
        result = []
        for campaign in campaigns:
            entries = list(db.scalars(
                select(CampaignContact)
                .options(joinedload(CampaignContact.contact), joinedload(CampaignContact.draft))
                .where(CampaignContact.campaign_id == campaign.id)
                .order_by(CampaignContact.id)
            ).all())
            states = [entry.state for entry in entries]
            sent = states.count("SENT")
            queued_times = [
                entry.scheduled_at for entry in entries
                if entry.state == "QUEUED" and entry.scheduled_at
            ]
            result.append({
                "id": campaign.id,
                "name": campaign.name,
                "status": campaign.status,
                "last_error": campaign.last_error,
                "started_at": _iso(campaign.started_at),
                "paused_at": _iso(campaign.paused_at),
                "next_send_at": _iso(min(queued_times)) if queued_times else None,
                "created_at": _iso(campaign.created_at),
                "progress": round((sent / len(entries)) * 100) if entries else 0,
                "entries": [_campaign_entry_dict(entry) for entry in entries],
                "counts": {
                    "total": len(entries),
                    "generated": states.count("GENERATED"),
                    "approved": states.count("APPROVED"),
                    "queued": states.count("QUEUED"),
                    "sent": sent,
                    "failed": states.count("FAILED"),
                },
            })
        return result


def generate_drafts(owner_id, contact_ids, profile, resume_filename):
    with SessionLocal() as db:
        contacts = _eligible_contacts(db, owner_id, contact_ids)
        if not contacts:
            raise ValueError("No eligible contacts were selected.")
        name = f"Campaign {datetime.now(timezone.utc):%Y-%m-%d %H:%M}"
        campaign = Campaign(user_id=int(owner_id), name=name, status="DRAFT")
        db.add(campaign)
        db.flush()
        entry_ids = {}
        for contact in contacts:
            entry = CampaignContact(
                campaign_id=campaign.id, contact_id=contact.id, state="PENDING"
            )
            db.add(entry)
            db.flush()
            entry_ids[contact.id] = entry.id
        campaign_id = campaign.id
        db.commit()

    writer = AIWriter(profile)
    generated = 0
    failures = []
    for contact in contacts:
        try:
            content = writer.generate(contact, resume_filename)
            draft_id = save_draft(
                contact.id,
                content.get("subject", ""),
                content.get("body", ""),
                owner_id=owner_id,
            )
            with SessionLocal() as db:
                entry = db.get(CampaignContact, entry_ids[contact.id])
                entry.draft_id = draft_id
                entry.state = "GENERATED"
                entry.error = ""
                db.commit()
            generated += 1
        except Exception as exc:
            with SessionLocal() as db:
                entry = db.get(CampaignContact, entry_ids[contact.id])
                entry.state = "FAILED"
                entry.error = str(exc)[:500]
                db.commit()
            failures.append({
                "contact_id": contact.id,
                "company_name": contact.company_name,
                "error": str(exc)[:200],
            })
    return {
        "campaign_id": campaign_id,
        "generated": generated,
        "failed": len(failures),
        "failures": failures,
    }


def approve_drafts(campaign_id, owner_id, draft_ids):
    with SessionLocal() as db:
        campaign = db.get(Campaign, int(campaign_id))
        if not campaign or campaign.user_id != int(owner_id):
            raise ValueError("Campaign not found.")
        ids = sorted({int(value) for value in draft_ids})
        entries = list(db.scalars(
            select(CampaignContact).where(
                CampaignContact.campaign_id == campaign.id,
                CampaignContact.draft_id.in_(ids),
            )
        ).all())
        entry_ids = [entry.id for entry in entries]

    approved = 0
    errors = []
    for entry_id in entry_ids:
        with SessionLocal() as db:
            entry = db.get(CampaignContact, entry_id)
            if not entry or not entry.draft_id:
                continue
            draft_id = entry.draft_id
        try:
            approve_draft(draft_id, owner_id)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        with SessionLocal() as db:
            entry = db.get(CampaignContact, entry_id)
            entry.state = "APPROVED"
            entry.error = ""
            db.commit()
        approved += 1
    return {"approved": approved, "errors": errors[:10]}


def queue_campaign(campaign_id, owner_id, stagger_seconds: int = 60):
    """Queue approved drafts for sending with optional staggering.

    Args:
        campaign_id: Campaign to queue
        owner_id: Owner user ID
        stagger_seconds: Seconds between each scheduled send (default 60)
    """
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        campaign = db.get(Campaign, int(campaign_id))
        if not campaign or campaign.user_id != int(owner_id):
            raise ValueError("Campaign not found.")
        entries = list(db.scalars(
            select(CampaignContact)
            .options(joinedload(CampaignContact.draft))
            .where(CampaignContact.campaign_id == campaign.id)
        ).all())
        queued = 0
        for i, entry in enumerate(entries):
            if entry.state == "APPROVED" and entry.draft and entry.draft.status == "APPROVED":
                entry.state = "QUEUED"
                # Stagger sends to respect rate limits
                entry.scheduled_at = now + timedelta(seconds=stagger_seconds * i)
                queued += 1
        if not queued:
            raise ValueError("Approve at least one draft before queueing.")
        campaign.status = "QUEUED"
        db.commit()
        return {"queued": queued}


def claim_for_send(draft_id, owner_id, now=None, allowed_states=None):
    """Atomically reserve a campaign entry for an external send.

    Returns ``None`` when the draft is not part of a campaign, ``True`` when
    the reservation was claimed, and ``False`` when another sender owns it.
    """
    now = now or datetime.now(timezone.utc)
    states = set(allowed_states or CLAIMABLE_STATES)
    with SessionLocal() as db:
        entry = db.scalar(
            select(CampaignContact)
            .join(Campaign)
            .where(CampaignContact.draft_id == int(draft_id), Campaign.user_id == int(owner_id))
        )
        if not entry:
            return None
        owned_campaigns = select(Campaign.id).where(Campaign.user_id == int(owner_id))
        result = db.execute(
            update(CampaignContact)
            .where(
                CampaignContact.id == entry.id,
                CampaignContact.campaign_id.in_(owned_campaigns),
                CampaignContact.state.in_(states),
            )
            .values(state="SENDING", reserved_at=now)
        )
        db.commit()
        return result.rowcount == 1


def release_send_claim(draft_id, owner_id, state, now=None):
    now = now or datetime.now(timezone.utc)
    if state not in {"DRAFT", "GENERATED", "APPROVED", "QUEUED", "FAILED"}:
        raise ValueError(f"Unsupported release state: {state}")
    values = {"state": state, "reserved_at": None}
    if state == "QUEUED":
        values["scheduled_at"] = now
    elif state == "FAILED":
        values["scheduled_at"] = None
    with SessionLocal() as db:
        entry = db.scalar(
            select(CampaignContact)
            .join(Campaign)
            .where(CampaignContact.draft_id == int(draft_id), Campaign.user_id == int(owner_id))
        )
        if not entry:
            return False
        result = db.execute(
            update(CampaignContact)
            .where(CampaignContact.id == entry.id, CampaignContact.state == "SENDING")
            .values(**values)
        )
        if state in {"DRAFT", "GENERATED"}:
            campaign = db.get(Campaign, entry.campaign_id)
            if campaign and campaign.status in {"QUEUED", "COMPLETED"}:
                campaign.status = "DRAFT"
        db.commit()
        return result.rowcount == 1


def finalize_send(draft_id, owner_id, now=None):
    now = now or datetime.now(timezone.utc)
    with SessionLocal() as db:
        entry = db.scalar(
            select(CampaignContact)
            .join(Campaign)
            .where(CampaignContact.draft_id == int(draft_id), Campaign.user_id == int(owner_id))
        )
        if not entry:
            return False
        owned_campaigns = select(Campaign.id).where(Campaign.user_id == int(owner_id))
        result = db.execute(
            update(CampaignContact)
            .where(
                CampaignContact.id == entry.id,
                CampaignContact.campaign_id.in_(owned_campaigns),
                CampaignContact.state == "SENDING",
            )
            .values(
                state="SENT",
                sent_at=now,
                reserved_at=None,
                error="",
                attempts=CampaignContact.attempts + 1,
            )
        )
        if result.rowcount != 1:
            db.commit()
            return False
        pending = db.scalar(
            select(CampaignContact.id).where(
                CampaignContact.campaign_id == entry.campaign_id,
                CampaignContact.state != "SENT",
            )
        )
        campaign = db.get(Campaign, entry.campaign_id)
        if campaign and not pending:
            campaign.status = "COMPLETED"
        db.commit()
        return True


def sync_draft_state(draft_id, owner_id, state):
    with SessionLocal() as db:
        entry = db.scalar(
            select(CampaignContact)
            .join(Campaign)
            .where(CampaignContact.draft_id == int(draft_id), Campaign.user_id == int(owner_id))
        )
        if not entry:
            return False
        entry.state = state
        if state == "SENT":
            entry.sent_at = datetime.now(timezone.utc)
            entry.attempts += 1
        db.flush()
        campaign = db.get(Campaign, entry.campaign_id)
        if campaign and state in {"DRAFT", "GENERATED"} and campaign.status in {"QUEUED", "COMPLETED"}:
            campaign.status = "DRAFT"
        db.commit()
        return True
