from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.db.models import AuditLog
from app.db.session import SessionLocal


def log(owner_id, action, details="", contact_id=None):
    if owner_id is None:
        return
    try:
        with SessionLocal() as db:
            db.add(AuditLog(
                user_id=int(owner_id),
                contact_id=int(contact_id) if contact_id is not None else None,
                action=str(action)[:80],
                details=str(details or "")[:2000],
            ))
            db.commit()
    except Exception:
        pass


def list_logs(owner_id, limit=100):
    limit = min(max(int(limit), 1), 200)
    with SessionLocal() as db:
        rows = list(db.scalars(
            select(AuditLog)
            .options(joinedload(AuditLog.contact))
            .where(AuditLog.user_id == int(owner_id))
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(limit)
        ).all())
        return [
            {
                "id": row.id,
                "action": row.action,
                "details": row.details,
                "contact_id": row.contact_id,
                "company_name": row.contact.company_name if row.contact else "",
                "contact_email": row.contact.email if row.contact else "",
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
