from datetime import datetime, timedelta, timezone

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import func, select, update

from app.config import settings
from app.db.models import Contact, EmailDraft, JobPosting, OutreachEvent, User
from app.db.session import SessionLocal
from app.services import mailer, profile_service, security


def _now():
    return datetime.now(timezone.utc)


def _expired(value):
    if not value:
        return True
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value < _now()


def _normalize_email(value):
    try:
        return validate_email(str(value or "").strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise ValueError("Enter a valid email address.") from exc


def get_user(user_id):
    with SessionLocal() as db:
        return db.get(User, int(user_id))


def claim_legacy_data(db, user_id):
    for model in (Contact, EmailDraft, JobPosting, OutreachEvent):
        db.execute(
            update(model).where(model.owner_id.is_(None)).values(owner_id=int(user_id))
        )


def register(name, email, password):
    name = str(name or "").strip()
    if len(name) < 2:
        raise ValueError("Enter your full name.")
    email = _normalize_email(email)
    if len(str(password or "")) < 8:
        raise ValueError("Password must be at least 8 characters.")

    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)):
            raise ValueError("An account with this email already exists.")
        is_first_user = (db.scalar(select(func.count(User.id))) or 0) == 0
        token = security.new_token()
        user = User(
            name=name[:200], email=email[:320],
            password_hash=security.hash_password(password),
            is_verified=False,
            verification_hash=security.hash_token(token),
            verification_expires_at=_now() + timedelta(hours=settings.verification_token_hours),
        )
        db.add(user)
        db.flush()
        if is_first_user:
            claim_legacy_data(db, user.id)
        db.commit()
        if is_first_user:
            profile_service.claim_legacy_resume(user.id)
        db.refresh(user)

    sent = mailer.send_verification_email(user.email, token)
    return user, token, sent


def verify_email(token):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.verification_hash == security.hash_token(token)))
        if not user:
            raise ValueError("Invalid verification link.")
        if _expired(user.verification_expires_at):
            raise ValueError("Verification link expired. Request a new one.")
        user.is_verified = True
        user.verification_hash = None
        user.verification_expires_at = None
        db.commit()
        db.refresh(user)
        return user


def resend_verification(email):
    try:
        email = _normalize_email(email)
    except ValueError:
        return None, None, False
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user or user.is_verified:
            return None, None, False
        token = security.new_token()
        user.verification_hash = security.hash_token(token)
        user.verification_expires_at = _now() + timedelta(hours=settings.verification_token_hours)
        db.commit()
    return user, token, mailer.send_verification_email(email, token)


def authenticate(email, password):
    try:
        email = _normalize_email(email)
    except ValueError:
        return None
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user or not security.verify_password(str(password or ""), user.password_hash):
            return None
        user.last_login_at = _now()
        db.commit()
        db.refresh(user)
        return user


def request_reset(email):
    try:
        email = _normalize_email(email)
    except ValueError:
        return None, None, False
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            return None, None, False
        token = security.new_token()
        user.reset_hash = security.hash_token(token)
        user.reset_expires_at = _now() + timedelta(hours=settings.reset_token_hours)
        db.commit()
    return user, token, mailer.send_password_reset_email(email, token)


def reset_password(token, password):
    password = str(password or "")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.reset_hash == security.hash_token(token)))
        if not user:
            raise ValueError("Invalid password reset link.")
        if _expired(user.reset_expires_at):
            raise ValueError("Password reset link expired. Request a new one.")
        user.password_hash = security.hash_password(password)
        user.reset_hash = None
        user.reset_expires_at = None
        db.commit()
        db.refresh(user)
        return user
