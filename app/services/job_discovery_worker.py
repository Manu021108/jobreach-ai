import threading

from sqlalchemy import select

from app.config import settings
from app.db import session as db_session
from app.db.models import JobAlert, User

_stop_event = threading.Event()
_thread = None
_lock = threading.Lock()


def _run_once():
    from app.services import job_alerts

    with db_session.SessionLocal() as db:
        owner_ids = list(db.scalars(
            select(User.id)
            .join(JobAlert, JobAlert.owner_id == User.id)
            .where(JobAlert.active.is_(True))
            .distinct()
        ).all())
    for owner_id in owner_ids:
        if _stop_event.is_set():
            return
        with db_session.SessionLocal() as db:
            alert_ids = list(db.scalars(
                select(JobAlert.id).where(JobAlert.owner_id == owner_id, JobAlert.active.is_(True))
            ).all())
        for alert_id in alert_ids:
            if _stop_event.is_set():
                return
            job_alerts.run_alert(owner_id, alert_id)


def _loop():
    interval = settings.job_discovery_poll_seconds
    while not _stop_event.is_set():
        try:
            _run_once()
        except Exception:
            pass
        if _stop_event.wait(interval):
            return


def start_worker():
    global _thread
    if not settings.job_discovery_enabled:
        return
    with _lock:
        if _thread and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(target=_loop, name="job-discovery-worker", daemon=True)
        _thread.start()


def stop_worker():
    global _thread
    _stop_event.set()
    with _lock:
        if _thread and _thread.is_alive():
            _thread.join(timeout=2)
        _thread = None
