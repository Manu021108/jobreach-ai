from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from google.oauth2.credentials import Credentials
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import main
from app.config import settings
from app.db import session as db_session
from app.db.models import Base, GmailConnection
from app.services import auth as auth_service
from app.services import gmail_service, gmail_tokens
from app.services import outreach as outreach_service
from app.services import profile_service


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    database = tmp_path / "gmail.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    for module in (db_session, auth_service, gmail_tokens, main, outreach_service, profile_service):
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    return lambda: TestClient(main.app)


def _credentials(token="access-token", expired=False):
    expiry = datetime.now(timezone.utc) + (timedelta(days=-1) if expired else timedelta(hours=1))
    info = {
        "token": token,
        "refresh_token": "refresh-token",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "client-id",
        "client_secret": "client-secret",
        "scopes": settings.scopes,
        "expiry": expiry.isoformat(),
    }
    return Credentials.from_authorized_user_info(info, settings.scopes)


def _signup(client, email):
    result = client.post("/api/auth/register", json={
        "name": "Gmail Student", "email": email, "password": "studentpass1",
    }).json()
    client.post("/api/auth/verify-email", json={"token": result["dev_verification_token"]})
    return client.post("/api/auth/login", json={
        "email": email, "password": "studentpass1",
    }).json()


def test_gmail_tokens_are_encrypted_and_scoped_to_one_user(client_factory):
    client_factory()
    user_id = 1
    gmail_tokens.save_credentials(user_id, _credentials(), "one@gmail.example")

    with db_session.SessionLocal() as db:
        raw = db.scalar(select(GmailConnection.encrypted_credentials))
    assert "access-token" not in raw
    assert "refresh-token" not in raw
    assert gmail_tokens.connection_status(user_id)["connected"] is True
    assert gmail_tokens.connection_status(user_id)["email"] == "one@gmail.example"
    credentials, email, _ = gmail_tokens.load_credentials(user_id)
    assert credentials.token == "access-token"
    assert email == "one@gmail.example"

    with pytest.raises(gmail_tokens.GmailAuthError):
        gmail_tokens.load_credentials(2)
    assert gmail_tokens.connection_status(2)["connected"] is False

    gmail_tokens.delete_credentials(user_id)
    assert gmail_tokens.connection_status(user_id)["connected"] is False


def test_expired_gmail_token_is_refreshed_and_saved(client_factory, monkeypatch):
    client_factory()
    gmail_tokens.save_credentials(1, _credentials(token="stale-token", expired=True), "one@gmail.example")

    def fake_refresh(self, request):
        self.token = "fresh-token"
        self.expiry = datetime.now(timezone.utc) + timedelta(hours=1)

    monkeypatch.setattr(Credentials, "refresh", fake_refresh)
    credentials, _email, _expiry = gmail_tokens.load_credentials(1)

    assert credentials.token == "fresh-token"
    refreshed, _, _ = gmail_tokens.load_credentials(1)
    assert refreshed.token == "fresh-token"


def test_oauth_web_flow_state_callback_connected_state_and_disconnect(client_factory, monkeypatch):
    student_a, student_b = client_factory(), client_factory()
    user_a = _signup(student_a, "oauth-a@example.com")
    _signup(student_b, "oauth-b@example.com")
    captured = {}

    class FakeFlow:
        def authorization_url(self, **kwargs):
            captured["state"] = kwargs["state"]
            return "https://accounts.example.com/oauth?" + "state=" + kwargs["state"], None

    monkeypatch.setattr(gmail_service, "build_oauth_flow", lambda: FakeFlow())
    monkeypatch.setattr(
        gmail_service,
        "complete_oauth",
        lambda code: (_credentials(token=f"code-{code}"), "student@gmail.example"),
    )

    started = student_a.get("/api/gmail/oauth/start")
    assert started.status_code == 200
    state = started.json()["authorization_url"].split("state=", 1)[1]
    assert state == captured["state"]
    assert student_a.get(
        "/api/gmail/oauth/callback", params={"code": "abc", "state": "wrong"}, follow_redirects=False
    ).status_code == 303
    assert student_a.get("/api/settings").json()["gmail_connected"] is False

    finished = student_a.get(
        "/api/gmail/oauth/callback", params={"code": "abc", "state": state}, follow_redirects=False
    )
    assert finished.status_code == 303
    assert finished.headers["location"] == "/?gmail=connected"

    settings_a = student_a.get("/api/settings").json()
    assert settings_a["gmail_connected"] is True
    assert settings_a["gmail_email"] == "student@gmail.example"
    assert settings_a["gmail_needs_reconnect"] is False
    assert student_b.get("/api/settings").json()["gmail_connected"] is False

    assert student_a.post("/api/gmail/disconnect").status_code == 200
    assert student_a.get("/api/settings").json()["gmail_connected"] is False
    assert user_a["email"] == "oauth-a@example.com"
