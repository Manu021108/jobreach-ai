from celery import shared_task

from app.config import settings
from app.services import auto_sender, followups, job_discovery_worker


@shared_task(
    name="jobreach.auto_send_run_once",
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def auto_send_run_once():
    if not settings.auto_send_worker_enabled:
        return {"status": "disabled"}
    return auto_sender.run_once()


@shared_task(
    name="jobreach.followups_run_once",
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def followups_run_once():
    if not settings.followup_auto_draft_enabled:
        return {"status": "disabled"}
    return followups.run_once()


@shared_task(
    name="jobreach.job_discovery_run_once",
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def job_discovery_run_once():
    if not settings.job_discovery_enabled:
        return {"status": "disabled"}
    return job_discovery_worker.run_once()
