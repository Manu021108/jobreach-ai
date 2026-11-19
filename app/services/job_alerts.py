from datetime import datetime, timezone

from sqlalchemy import func, select

from app.config import settings
from app.db import session as db_session
from app.db.models import JobAlert, JobNotification, User
from app.services import audit, mailer
from app.services.job_discovery_engine import discover_for_owner

ALERT_FIELDS = (
    "name",
    "query",
    "skills",
    "location",
    "experience",
    "salary_min",
    "fresher_only",
    "sources",
    "active",
    "email_enabled",
    "include_companies",
)


def _as_utc(value):
    if not value:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _string(value):
    if isinstance(value, (list, tuple, set)):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def alert_payload(alert):
    return {
        "id": alert.id,
        "name": alert.name,
        "query": alert.query,
        "skills": alert.skills,
        "location": alert.location,
        "experience": alert.experience,
        "salary_min": alert.salary_min,
        "fresher_only": bool(alert.fresher_only),
        "sources": alert.sources,
        "active": bool(alert.active),
        "email_enabled": bool(alert.email_enabled),
        "include_companies": bool(alert.include_companies),
        "last_run_at": _as_utc(alert.last_run_at).isoformat() if alert.last_run_at else None,
        "last_run_count": alert.last_run_count,
        "last_error": alert.last_error,
        "created_at": _as_utc(alert.created_at).isoformat() if alert.created_at else None,
    }


def list_alerts(owner_id):
    with db_session.SessionLocal() as db:
        rows = list(db.scalars(
            select(JobAlert)
            .where(JobAlert.owner_id == int(owner_id))
            .order_by(JobAlert.created_at.desc(), JobAlert.id.desc())
        ).all())
        return [alert_payload(row) for row in rows]


def get_alert(alert_id, owner_id):
    with db_session.SessionLocal() as db:
        return db.scalar(
            select(JobAlert).where(JobAlert.id == int(alert_id), JobAlert.owner_id == int(owner_id))
        )


def create_alert(owner_id, values):
    name = _string(values.get("name")) or "New opportunities"
    with db_session.SessionLocal() as db:
        alert = JobAlert(owner_id=int(owner_id), name=name[:200])
        apply_alert_values(alert, values)
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert_payload(alert)


def apply_alert_values(alert, values):
    for field in ALERT_FIELDS:
        if field not in values:
            continue
        value = values[field]
        if field in {"fresher_only", "active", "email_enabled", "include_companies"}:
            setattr(alert, field, bool(value))
        elif field == "salary_min":
            setattr(alert, field, int(value) if value not in (None, "", 0) else None)
        elif field in {"query", "location", "experience"}:
            setattr(alert, field, _string(value)[: getattr(JobAlert, field).property.columns[0].type.length])
        elif field == "name":
            alert.name = _string(value)[:200] or "New opportunities"
        else:
            setattr(alert, field, _string(value))


def update_alert(alert_id, owner_id, values):
    with db_session.SessionLocal() as db:
        alert = db.scalar(
            select(JobAlert).where(JobAlert.id == int(alert_id), JobAlert.owner_id == int(owner_id))
        )
        if not alert:
            return None
        apply_alert_values(alert, values)
        db.commit()
        db.refresh(alert)
        return alert_payload(alert)


def delete_alert(alert_id, owner_id):
    with db_session.SessionLocal() as db:
        alert = db.scalar(
            select(JobAlert).where(JobAlert.id == int(alert_id), JobAlert.owner_id == int(owner_id))
        )
        if not alert:
            return False
        db.delete(alert)
        db.commit()
        return True


def notification_payload(row):
    return {
        "id": row.id,
        "alert_id": row.alert_id,
        "alert_name": row.alert.name if row.alert else "Job discovery",
        "job_id": row.job_id,
        "title": row.title,
        "message": row.message,
        "url": row.url,
        "read": bool(row.read_at),
        "read_at": _as_utc(row.read_at).isoformat() if row.read_at else None,
        "created_at": _as_utc(row.created_at).isoformat() if row.created_at else None,
    }


def list_notifications(owner_id, limit=50, unread_only=False):
    limit = min(max(int(limit), 1), 100)
    with db_session.SessionLocal() as db:
        statement = select(JobNotification).where(JobNotification.owner_id == int(owner_id))
        if unread_only:
            statement = statement.where(JobNotification.read_at.is_(None))
        rows = list(db.scalars(
            statement.order_by(JobNotification.created_at.desc(), JobNotification.id.desc()).limit(limit)
        ).all())
        return [notification_payload(row) for row in rows]


def unread_count(owner_id):
    with db_session.SessionLocal() as db:
        return int(db.scalar(
            select(func.count(JobNotification.id)).where(
                JobNotification.owner_id == int(owner_id),
                JobNotification.read_at.is_(None),
            )
        ) or 0)


def mark_notification_read(notification_id, owner_id):
    with db_session.SessionLocal() as db:
        row = db.scalar(
            select(JobNotification).where(
                JobNotification.id == int(notification_id),
                JobNotification.owner_id == int(owner_id),
            )
        )
        if not row:
            return False
        row.read_at = datetime.now(timezone.utc)
        db.commit()
        return True


def mark_all_read(owner_id):
    with db_session.SessionLocal() as db:
        rows = list(db.scalars(
            select(JobNotification).where(
                JobNotification.owner_id == int(owner_id),
                JobNotification.read_at.is_(None),
            )
        ).all())
        for row in rows:
            row.read_at = datetime.now(timezone.utc)
        db.commit()
        return len(rows)


def create_notifications(owner_id, alert, jobs):
    if not jobs:
        return 0
    with db_session.SessionLocal() as db:
        existing = set(db.scalars(
            select(JobNotification.fingerprint).where(JobNotification.owner_id == int(owner_id))
        ).all())
        created = []
        for job in jobs:
            fingerprint = f"{alert.id}:{job.get('fingerprint') or job.get('url')}"
            if fingerprint in existing:
                continue
            existing.add(fingerprint)
            title = f"New role: {job.get('title', 'Open role')}"
            message = f"{job.get('company_name', 'Unknown company')} · {job.get('location') or 'Location flexible'}"
            row = JobNotification(
                owner_id=int(owner_id),
                alert_id=int(alert.id),
                job_id=job.get("id"),
                title=title[:300],
                message=message[:2000],
                url=str(job.get("url") or "")[:1000],
                fingerprint=fingerprint[:300],
            )
            db.add(row)
            created.append(job)
        db.commit()

    if created and alert.email_enabled and settings.job_alert_email_enabled and settings.smtp_host:
        with db_session.SessionLocal() as db:
            user = db.get(User, int(owner_id))
        if user:
            mailer.send_job_alert_email(user.email, alert.name, created)
    return len(created)


def alert_filters(alert):
    return {
        "query": alert.query,
        "skills": alert.skills,
        "location": alert.location,
        "experience": alert.experience,
        "salary_min": alert.salary_min,
        "fresher_only": bool(alert.fresher_only),
        "sources": alert.sources,
        "include_companies": bool(alert.include_companies),
    }


def run_alert(owner_id, alert_id):
    alert = get_alert(alert_id, owner_id)
    if not alert:
        return None
    result = None
    try:
        result = discover_for_owner(owner_id, alert_filters(alert))
        notifications = create_notifications(owner_id, alert, result.get("jobs", []))
        with db_session.SessionLocal() as db:
            row = db.get(JobAlert, int(alert_id))
            row.last_run_at = datetime.now(timezone.utc)
            row.last_run_count = int(result.get("new_jobs", 0))
            row.last_error = ""
            db.commit()
        audit.log(owner_id, "JOB_ALERT_RUN", f"alert={alert.name[:80]} new={result.get('new_jobs', 0)}")
        return {**result, "notifications": notifications}
    except Exception as exc:
        with db_session.SessionLocal() as db:
            row = db.get(JobAlert, int(alert_id))
            if row:
                row.last_run_at = datetime.now(timezone.utc)
                row.last_error = f"{type(exc).__name__}: {exc}"[:2000]
                db.commit()
        return {
            "total_found": 0,
            "matched": 0,
            "new_jobs": 0,
            "updated_jobs": 0,
            "duplicate_jobs": 0,
            "warnings": [f"Alert run failed: {type(exc).__name__}"],
            "jobs": [],
            "notifications": 0,
            "error": str(exc),
        }
