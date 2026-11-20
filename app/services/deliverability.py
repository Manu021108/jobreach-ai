"""
Deliverability analytics service for email tracking, bounce handling,
domain reputation monitoring, and open/click tracking.
"""
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.db.models import (
    EmailTrackingEvent, DomainReputation, EmailDraft, Contact,
    Campaign, User, OutreachEvent
)
from app.db.session import SessionLocal
from app.services.gmail_service import GmailService

logger = logging.getLogger(__name__)


class DeliverabilityService:
    """Service for email deliverability tracking and analytics."""

    # Tracking pixel endpoint
    TRACKING_PIXEL_SIZE = 1  # 1x1 pixel

    # Bounce classification patterns
    HARD_BOUNCE_PATTERNS = [
        r"user unknown",
        r"no such user",
        r"mailbox unavailable",
        r"account (?:does not exist|disabled)",
        r"invalid recipient",
        r"recipient (?:not found|rejected)",
        r"550 5\.1\.1",
        r"550 5\.1\.2",
        r"550 5\.1\.3",
        r"550 5\.1\.4",
        r"550 5\.1\.5",
        r"550 5\.1\.6",
        r"550 5\.1\.7",
    ]

    SOFT_BOUNCE_PATTERNS = [
        r"mailbox full",
        r"quota exceeded",
        r"storage (?:full|limit)",
        r"temporary failure",
        r"try again later",
        r"connection (?:timed out|refused|reset)",
        r"server (?:busy|unavailable|timeout)",
        r"450 4\.2\.2",
        r"450 4\.2\.3",
        r"450 4\.3\.1",
        r"450 4\.4\.\d",
        r"451 4\.4\.\d",
        r"452 4\.2\.2",
        r"452 4\.3\.1",
    ]

    BLOCK_PATTERNS = [
        r"blocked",
        r"blacklisted",
        r"spam",
        r"rejected.*policy",
        r"rejected.*spam",
        r"550 5\.7\.1",
        r"554 5\.7\.1",
        r"RBL",
        r"DNSBL",
    ]

    COMPLAINT_PATTERNS = [
        r"complaint",
        r"abuse",
        r"feedback.*loop",
        r"FBL",
    ]

    def __init__(self):
        pass

    def _classify_bounce(self, smtp_response: str, bounce_reason: str) -> tuple[str, str]:
        """Classify bounce type and reason from SMTP response."""
        text = f"{smtp_response} {bounce_reason}".lower()

        # Check hard bounce
        for pattern in self.HARD_BOUNCE_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return "hard", "Hard bounce - permanent delivery failure"

        # Check soft bounce
        for pattern in self.SOFT_BOUNCE_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return "soft", "Soft bounce - temporary delivery failure"

        # Check block
        for pattern in self.BLOCK_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return "block", "Blocked by recipient server"

        # Check complaint
        for pattern in self.COMPLAINT_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return "complaint", "Spam complaint received"

        return "unknown", "Unknown bounce type"

    def generate_tracking_id(self) -> str:
        """Generate unique tracking ID for email tracking."""
        return str(uuid.uuid4())

    def create_tracking_event(
        self,
        event_type: str,
        email_draft_id: int | None = None,
        contact_id: int | None = None,
        campaign_id: int | None = None,
        user_id: int | None = None,
        recipient_email: str = "",
        sender_domain: str = "",
        smtp_response: str = "",
        bounce_type: str | None = None,
        bounce_reason: str = "",
        user_agent: str = "",
        ip_address: str | None = None,
        metadata: dict | None = None,
    ) -> EmailTrackingEvent:
        """Create and store a tracking event."""
        event = EmailTrackingEvent(
            event_id=self.generate_tracking_id(),
            event_type=event_type,
            email_draft_id=email_draft_id,
            contact_id=contact_id,
            campaign_id=campaign_id,
            user_id=user_id,
            recipient_email=recipient_email.lower(),
            sender_domain=sender_domain,
            smtp_response=smtp_response,
            bounce_type=bounce_type,
            bounce_reason=bounce_reason,
            user_agent=user_agent or "",
            ip_address=ip_address,
            event_metadata=json.dumps(metadata or {}),
        )

        with SessionLocal() as db:
            db.add(event)
            db.commit()
            db.refresh(event)

        return event

    def record_send(
        self,
        email_draft_id: int,
        contact_id: int,
        campaign_id: int | None,
        user_id: int,
        recipient_email: str,
        sender_domain: str,
        smtp_response: str = "",
    ) -> EmailTrackingEvent:
        """Record a sent email."""
        return self.create_tracking_event(
            event_type="sent",
            email_draft_id=email_draft_id,
            contact_id=contact_id,
            campaign_id=campaign_id,
            user_id=user_id,
            recipient_email=recipient_email,
            sender_domain=sender_domain,
            smtp_response=smtp_response,
        )

    def record_delivery(
        self,
        tracking_id: str,
        smtp_response: str = "",
    ) -> Optional[EmailTrackingEvent]:
        """Record successful delivery."""
        with SessionLocal() as db:
            event = db.scalar(
                select(EmailTrackingEvent).where(EmailTrackingEvent.event_id == tracking_id)
            )
            if event:
                event.event_type = "delivered"
                event.smtp_response = smtp_response
                event.occurred_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(event)
                return event
        return None

    def record_bounce(
        self,
        tracking_id: str,
        smtp_response: str,
        bounce_reason: str,
    ) -> Optional[EmailTrackingEvent]:
        """Record a bounce and classify it."""
        bounce_type, bounce_reason_classified = self._classify_bounce(smtp_response, bounce_reason)

        with SessionLocal() as db:
            event = db.scalar(
                select(EmailTrackingEvent).where(EmailTrackingEvent.event_id == tracking_id)
            )
            if event:
                event.event_type = "bounced"
                event.bounce_type = bounce_type
                event.bounce_reason = bounce_reason_classified
                event.smtp_response = smtp_response
                event.occurred_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(event)

                # Update domain reputation
                self._update_domain_reputation(event.sender_domain, bounce_type)

                # If hard bounce, mark contact as bounced
                if bounce_type == "hard" and event.contact_id:
                    contact = db.get(Contact, event.contact_id)
                    if contact:
                        contact.status = "BOUNCED"
                        db.commit()

                return event
        return None

    def record_open(
        self,
        tracking_id: str,
        user_agent: str = "",
        ip_address: str = "",
    ) -> Optional[EmailTrackingEvent]:
        """Record an email open (from tracking pixel)."""
        with SessionLocal() as db:
            event = db.scalar(
                select(EmailTrackingEvent).where(EmailTrackingEvent.event_id == tracking_id)
            )
            if event:
                # Only record first open
                if event.event_type not in ["opened", "clicked"]:
                    event.event_type = "opened"
                    event.user_agent = user_agent
                    event.ip_address = ip_address
                    event.occurred_at = datetime.now(timezone.utc)
                    db.commit()
                    db.refresh(event)
                    return event
            return None

    def record_click(
        self,
        tracking_id: str,
        user_agent: str = "",
        ip_address: str = "",
        metadata: dict | None = None,
    ) -> Optional[EmailTrackingEvent]:
        """Record a link click."""
        with SessionLocal() as db:
            event = db.scalar(
                select(EmailTrackingEvent).where(EmailTrackingEvent.event_id == tracking_id)
            )
            if event:
                event.event_type = "clicked"
                event.user_agent = user_agent
                event.ip_address = ip_address
                event.event_metadata = json.dumps(metadata or {})
                event.occurred_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(event)
                return event
        return None

    def record_complaint(
        self,
        recipient_email: str,
        sender_domain: str,
        user_id: int | None = None,
    ) -> EmailTrackingEvent:
        """Record a spam complaint."""
        event = self.create_tracking_event(
            event_type="complained",
            user_id=user_id,
            recipient_email=recipient_email,
            sender_domain=sender_domain,
            bounce_type="complaint",
            bounce_reason="Spam complaint received via feedback loop",
        )

        # Update domain reputation
        self._update_domain_reputation(sender_domain, "complaint")

        return event

    def record_unsubscribe(
        self,
        tracking_id: str,
        user_agent: str = "",
        ip_address: str = "",
    ) -> Optional[EmailTrackingEvent]:
        """Record an unsubscribe."""
        with SessionLocal() as db:
            event = db.scalar(
                select(EmailTrackingEvent).where(EmailTrackingEvent.event_id == tracking_id)
            )
            if event:
                event.event_type = "unsubscribed"
                event.user_agent = user_agent
                event.ip_address = ip_address
                event.occurred_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(event)
                return event
        return None

    def _update_domain_reputation(self, domain: str, event_type: str) -> None:
        """Update domain reputation based on event."""
        with SessionLocal() as db:
            rep = db.scalar(
                select(DomainReputation).where(DomainReputation.domain == domain.lower())
            )
            if not rep:
                rep = DomainReputation(domain=domain.lower())
                db.add(rep)

            if event_type == "sent":
                rep.total_sent += 1
            elif event_type == "delivered":
                rep.total_delivered += 1
            elif event_type in ("bounced", "hard"):
                rep.total_bounced += 1
            elif event_type == "complaint":
                rep.total_complained += 1
            elif event_type == "opened":
                rep.total_opened += 1
            elif event_type == "clicked":
                rep.total_clicked += 1

            # Calculate rates
            if rep.total_sent > 0:
                rep.bounce_rate = rep.total_bounced / rep.total_sent
                rep.spam_complaint_rate = rep.total_complained / rep.total_sent
            if rep.total_delivered > 0:
                rep.open_rate = rep.total_opened / rep.total_delivered
                rep.click_rate = rep.total_clicked / rep.total_delivered

            # Calculate reputation score (-1.0 to 1.0)
            # Based on bounce rate, complaint rate, and engagement
            score = 0.0
            if rep.total_sent > 0:
                score = 1.0 - (rep.bounce_rate * 0.4) - (rep.spam_complaint_rate * 0.4)
                if rep.open_rate > 0.2:
                    score += 0.1
                if rep.click_rate > 0.05:
                    score += 0.1
            rep.reputation_score = max(-1.0, min(1.0, score))

            rep.last_checked_at = datetime.now(timezone.utc)
            rep.updated_at = datetime.now(timezone.utc)
            db.commit()

    def get_domain_reputation(self, domain: str) -> Optional[DomainReputation]:
        """Get domain reputation."""
        with SessionLocal() as db:
            return db.scalar(
                select(DomainReputation).where(DomainReputation.domain == domain.lower())
            )

    def get_deliverability_stats(
        self,
        user_id: int,
        days: int = 30,
    ) -> dict:
        """Get deliverability statistics for a user."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        with SessionLocal() as db:
            events = db.scalars(
                select(EmailTrackingEvent).where(
                    EmailTrackingEvent.user_id == user_id,
                    EmailTrackingEvent.occurred_at >= cutoff,
                )
            ).all()

        stats = {
            "total_sent": 0,
            "delivered": 0,
            "bounced": 0,
            "hard_bounced": 0,
            "soft_bounced": 0,
            "blocked": 0,
            "opened": 0,
            "clicked": 0,
            "complained": 0,
            "unsubscribed": 0,
            "bounce_rate": 0.0,
            "open_rate": 0.0,
            "click_rate": 0.0,
            "complaint_rate": 0.0,
        }

        for event in events:
            if event.event_type == "sent":
                stats["total_sent"] += 1
            elif event.event_type == "delivered":
                stats["delivered"] += 1
            elif event.event_type == "bounced":
                stats["bounced"] += 1
                if event.bounce_type == "hard":
                    stats["hard_bounced"] += 1
                elif event.bounce_type == "soft":
                    stats["soft_bounced"] += 1
            elif event.event_type == "blocked":
                stats["blocked"] += 1
            elif event.event_type == "opened":
                stats["opened"] += 1
            elif event.event_type == "clicked":
                stats["clicked"] += 1
            elif event.event_type == "complained":
                stats["complained"] += 1
            elif event.event_type == "unsubscribed":
                stats["unsubscribed"] += 1

        sent = stats["total_sent"]
        delivered = stats["delivered"]

        if sent > 0:
            stats["bounce_rate"] = (stats["bounced"] + stats["blocked"]) / sent
            stats["complaint_rate"] = stats.get("complained", 0) / sent
        if delivered > 0:
            stats["open_rate"] = stats["opened"] / delivered
            stats["click_rate"] = stats["clicked"] / delivered

        return stats

    def get_domain_reputations(self, user_id: int | None = None, limit: int = 50) -> list[dict]:
        """Get domain reputations for a user or all."""
        with SessionLocal() as db:
            query = select(DomainReputation)
            if user_id:
                # Filter domains used by this user
                user_domains = db.scalars(
                    select(EmailTrackingEvent.sender_domain).where(
                        EmailTrackingEvent.user_id == user_id
                    ).distinct()
                ).all()
                if user_domains:
                    query = query.where(DomainReputation.domain.in_(user_domains))

            reps = db.scalars(
                query.order_by(DomainReputation.reputation_score.asc()).limit(limit)
            ).all()

        return [
            {
                "domain": r.domain,
                "reputation_score": round(r.reputation_score, 3),
                "spam_complaint_rate": round(r.spam_complaint_rate, 4),
                "bounce_rate": round(r.bounce_rate, 4),
                "open_rate": round(r.open_rate, 4),
                "click_rate": round(r.click_rate, 4),
                "total_sent": r.total_sent,
                "total_delivered": r.total_delivered,
                "total_bounced": r.total_bounced,
                "total_complained": r.total_complained,
                "last_checked": r.last_checked_at.isoformat() if r.last_checked_at else None,
            }
            for r in reps
        ]

    def generate_tracking_pixel(self, tracking_id: str) -> str:
        """Generate tracking pixel HTML for email."""
        return f'<img src="{settings.frontend_url.rstrip("/")}/api/track/open/{tracking_id}" width="1" height="1" alt="" style="display:none;">'

    def generate_tracking_link(self, tracking_id: str, destination_url: str) -> str:
        """Generate tracking link for click tracking."""
        return f"{settings.frontend_url.rstrip('/')}/api/track/click/{tracking_id}?url={destination_url}"

    def process_inbound_webhook(
        self,
        payload: dict,
        provider: str = "gmail",
    ) -> Optional[EmailTrackingEvent]:
        """Process inbound webhook from email provider (SendGrid, Postmark, etc.)."""
        event_type = payload.get("event", "").lower()
        email = payload.get("email", "").lower()
        tracking_id = payload.get("tracking_id") or payload.get("message_id") or ""

        if not tracking_id:
            return None

        with SessionLocal() as db:
            event = db.scalar(
                select(EmailTrackingEvent).where(EmailTrackingEvent.event_id == tracking_id)
            )
            if not event:
                return None

            if event_type in ("delivered", "delivery"):
                event.event_type = "delivered"
                event.occurred_at = datetime.now(timezone.utc)
            elif event_type in ("bounce", "bounced"):
                reason = payload.get("reason", "")
                self._classify_bounce(payload.get("smtp_response", ""), reason)
                # bounce is handled by record_bounce
            elif event_type in ("open", "opened"):
                event.event_type = "opened"
            elif event_type in ("click", "clicked"):
                event.event_type = "clicked"
            elif event_type in ("bounce", "bounced"):
                event.event_type = "bounced"
            elif event_type in ("complaint", "spamreport", "spam_report"):
                event.event_type = "complained"
            elif event_type in ("unsubscribe", "unsubscribed"):
                event.event_type = "unsubscribed"

            event.occurred_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(event)
            return event


# Global instance
deliverability_service = DeliverabilityService()


def get_deliverability_service() -> DeliverabilityService:
    """Get the global deliverability service instance."""
    return deliverability_service