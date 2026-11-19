from sqlalchemy import select

from app.db import session as db_session
from app.db.models import JobAlert, User
from app.services import job_alerts


def _run_once():
    with db_session.SessionLocal() as db:
        owner_ids = list(db.scalars(
            select(User.id)
            .join(JobAlert, JobAlert.owner_id == User.id)
            .where(JobAlert.active.is_(True))
            .distinct()
        ).all())
    for owner_id in owner_ids:
        with db_session.SessionLocal() as db:
            alert_ids = list(db.scalars(
                select(JobAlert.id).where(JobAlert.owner_id == owner_id, JobAlert.active.is_(True))
            ).all())
        for alert_id in alert_ids:
            job_alerts.run_alert(owner_id, alert_id)


def run_once():
    """Run a single discovery pass. Public for tests and manual triggers."""
    _run_once()
