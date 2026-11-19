from celery import Celery
from celery.schedules import schedule

from app.config import settings

celery_app = Celery(
    "jobreach",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.services.tasks"],
)


def _beat_entry(task: str, seconds: int) -> dict:
    return {
        "task": task,
        "schedule": schedule(float(seconds)),
        "options": {"expires": max(30, int(seconds) * 2)},
    }


beat_schedule = {}
if settings.auto_send_worker_enabled:
    beat_schedule["auto-send"] = _beat_entry("jobreach.auto_send_run_once", settings.auto_send_poll_seconds)
if settings.followup_auto_draft_enabled:
    beat_schedule["followups"] = _beat_entry("jobreach.followups_run_once", settings.followup_poll_seconds)
if settings.job_discovery_enabled:
    beat_schedule["job-discovery"] = _beat_entry("jobreach.job_discovery_run_once", settings.job_discovery_poll_seconds)

celery_app.conf.update(
    beat_schedule=beat_schedule,
    task_routes={"jobreach.*": {"queue": "jobreach"}},
    task_default_queue="jobreach",
    task_default_exchange="jobreach",
    task_default_exchange_type="direct",
    task_default_routing_key="jobreach",
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    task_time_limit=settings.celery_task_time_limit,
    task_soft_time_limit=max(60, settings.celery_task_time_limit - 30),
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    result_expires=3600,
    timezone=settings.timezone,
    enable_utc=True,
)

from app.services import tasks as _tasks
