"""Background job-discovery worker.

Recurring job: run every ``settings.job_discovery_poll_seconds`` for every user
with at least one active job alert. Runs are guarded by a lock so a slow run
cannot overlap itself, and failures are logged per-run instead of killing the
loop.
"""

from sqlalchemy import select

from app.config import settings
from app.db import session as db_session
from app.db.models import JobAlert, User
from app.services import job_alerts
from app.services import worker as worker_manager


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


def start_worker():
    """Register and start the recurring job-discovery job."""
    if not settings.job_discovery_enabled:
        return
    worker_manager.worker.register(
        "job_discovery",
        _run_once,
        settings.job_discovery_poll_seconds,
        description="Run active job alerts",
    )
    worker_manager.start_worker()


def stop_worker():
    """Stop the shared worker scheduler (idempotent)."""
    worker_manager.stop_worker()