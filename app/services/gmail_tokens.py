import base64
import hashlib
import json
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from sqlalchemy import select

from app.config import settings
from app.db.models import GmailConnection
from app.db.session import SessionLocal


class GmailAuthError(Exception):
    pass


_KEY_SOURCE = settings.gmail_token_encryption_key or settings.auth_secret_key or "jobreach-local-dev-token-key"
_FERNET = Fernet(base64.urlsafe_b64encode(hashlib.sha256(_KEY_SOURCE.encode("utf-8")).digest()))


def _utc(value):
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _iso(value):
    value = _utc(value)
    return value.isoformat() if value else None


def _encrypt(credentials):
    info = json.loads(credentials.to_json())
    return _FERNET.encrypt(json.dumps(info).encode("utf-8")).decode("ascii")


def _decrypt(value):
    try:
        info = json.loads(_FERNET.decrypt(value.encode("ascii")).decode("utf-8"))
        return Credentials.from_authorized_user_info(info, settings.scopes)
    except (InvalidToken, ValueError, TypeError, KeyError) as exc:
        raise GmailAuthError("Stored Gmail token could not be read. Reconnect your account.") from exc


def _expiry(credentials):
    return _utc(getattr(credentials, "expiry", None))


def _find_row(db, owner_id):
    return db.scalar(select(GmailConnection).where(GmailConnection.user_id == int(owner_id)))


def load_credentials(owner_id, refresh=True):
    with SessionLocal() as db:
        row = _find_row(db, owner_id)
        if not row:
            raise GmailAuthError("Connect your Gmail account in Settings first.")
        try:
            credentials = _decrypt(row.encrypted_credentials)
        except GmailAuthError:
            row.needs_reconnect = True
            db.commit()
            raise
        if refresh and not credentials.valid:
            if not credentials.expired or not credentials.refresh_token:
                row.needs_reconnect = True
                db.commit()
                raise GmailAuthError("Your Gmail connection expired. Reconnect your account.")
            try:
                credentials.refresh(Request())
            except RefreshError as exc:
                row.needs_reconnect = True
                db.commit()
                raise GmailAuthError("Gmail token refresh failed. Reconnect your account.") from exc
            row.encrypted_credentials = _encrypt(credentials)
            row.expires_at = _expiry(credentials)
            row.needs_reconnect = False
            row.updated_at = datetime.now(timezone.utc)
            db.commit()
        return credentials, row.email, _expiry(credentials) or row.expires_at


def save_credentials(owner_id, credentials, email):
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        row = _find_row(db, owner_id)
        if not row:
            row = GmailConnection(user_id=int(owner_id), connected_at=now)
            db.add(row)
        row.email = str(email or "")[:320]
        row.encrypted_credentials = _encrypt(credentials)
        row.scopes = ",".join(credentials.scopes or settings.scopes)
        row.expires_at = _expiry(credentials)
        row.needs_reconnect = False
        row.updated_at = now
        db.commit()
        db.refresh(row)
        return row


def connection_status(owner_id):
    with SessionLocal() as db:
        row = _find_row(db, owner_id)
        if not row:
            return {
                "connected": False,
                "email": None,
                "expires_at": None,
                "needs_reconnect": False,
            }
        connected = not row.needs_reconnect
        try:
            credentials = _decrypt(row.encrypted_credentials)
            if not credentials.valid and not (credentials.expired and credentials.refresh_token):
                connected = False
        except GmailAuthError:
            connected = False
        return {
            "connected": connected,
            "email": row.email,
            "expires_at": _iso(row.expires_at),
            "needs_reconnect": bool(row.needs_reconnect) or not connected,
        }


def delete_credentials(owner_id):
    with SessionLocal() as db:
        row = _find_row(db, owner_id)
        if row:
            db.delete(row)
            db.commit()
