from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from app.config import settings
from app.db import session as db_session
from app.db.models import Base, Contact
from app.services import audit
from app.services import auth as auth_service
from app.services import auto_sender
from app.services import campaign as campaign_service
from app.services import gmail_tokens
from app.services import outreach as outreach_service
from app.services import profile_service


class FakeWriter:
    def __init__(self, profile):
        self.profile = profile

    def generate(self, contact, resume_filename):
        return {
            "subject": f"Hello {contact.company_name}",
            "body": f"Body for {contact.email}",
        }


class FakeGmail:
    sent = []
    failures = []

    def __init__(self, owner_id):
        self.owner_id = owner_id

    def connect(self):
        return self

    def send(self, recipient, subject, body, attachment, sender_name=None):
        if FakeGmail.failures:
            raise FakeGmail.failures.pop(0)
        FakeGmail.sent.append({
            "recipient": recipient,
            "subject": subject,
            "attachment": attachment.name,
            "sender_name": sender_name,
        })
        return {"id": f"msg-{len(FakeGmail.sent)}", "threadId": "thread-1"}


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    FakeGmail.sent = []
    FakeGmail.failures = []
    database = tmp_path / "auto_sender.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    modules = (
        db_session, audit, auth_service, gmail_tokens, outreach_service, profile_service,
        campaign_service, auto_sender, main,
    )
    for module in modules:
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(campaign_service, "AIWriter", FakeWriter)
    monkeypatch.setattr(auto_sender, "GmailService", FakeGmail)
    monkeypatch.setattr(auto_sender.gmail_tokens, "connection_status", lambda owner_id: {
        "connected": True,
        "email": "sender@example.com",
        "expires_at": None,
        "needs_reconnect": False,
    })
    monkeypatch.setattr(
        auto_sender.profile_service,
        "get_resume",
        lambda owner_id: SimpleNamespace(filename="resume.pdf"),
    )
    monkeypatch.setattr(auto_sender.profile_service, "profile_dict", lambda owner_id: {"full_name": "Auto Sender"})
    counter = {"value": 0}

    def fake_resume(owner_id):
        counter["value"] += 1
        path = tmp_path / f"resume-{counter['value']}.pdf"
        path.write_bytes(b"%PDF-1.4")
        return path

    monkeypatch.setattr(auto_sender, "_resume_tempfile", fake_resume)
    monkeypatch.setattr(settings, "dry_run", False)
    monkeypatch.setattr(settings, "max_emails_per_day", 20)
    monkeypatch.setattr(settings, "min_seconds_between_emails", 0)
    monkeypatch.setattr(settings, "auto_send_max_attempts", 3)
    monkeypatch.setattr(settings, "auto_send_retry_backoff_seconds", 60)
    return lambda: (TestClient(main.app), factory)


def _signup(client, email="student@auto-sender.example"):
    result = client.post("/api/auth/register", json={
        "name": "Auto Sender",
        "email": email,
        "password": "studentpass1",
    }).json()
    assert client.post("/api/auth/verify-email", json={
        "token": result["dev_verification_token"],
    }).status_code == 200
    login = client.post("/api/auth/login", json={
        "email": email,
        "password": "studentpass1",
    })
    assert login.status_code == 200
    return login.json()


def _add_contacts(factory, owner_id, count):
    with factory() as db:
        contacts = [
            Contact(
                company_name=f"Company {index}",
                email=f"hr{index}@example.com",
                role="Recruiter",
                owner_id=owner_id,
            )
            for index in range(count)
        ]
        db.add_all(contacts)
        db.commit()
        return [contact.id for contact in contacts]


def _ready_campaign(client, factory, count=2):
    user = _signup(client)
    contact_ids = _add_contacts(factory, user["id"], count)
    generated = client.post("/api/campaigns/generate", json={"contact_ids": contact_ids})
    assert generated.status_code == 200
    campaign = client.get("/api/campaigns").json()[0]
    draft_ids = [entry["draft_id"] for entry in campaign["entries"] if entry["draft_id"]]
    assert len(draft_ids) == count
    assert client.post(f"/api/campaigns/{campaign['id']}/approve", json={
        "draft_ids": draft_ids,
    }).status_code == 200
    assert client.post(f"/api/campaigns/{campaign['id']}/queue").status_code == 200
    return user, client.get("/api/campaigns").json()[0]


def test_auto_sender_sends_one_at_a_time_and_completes(client_factory, monkeypatch):
    client, factory = client_factory()
    monkeypatch.setattr(settings, "min_seconds_between_emails", 45)
    _, campaign = _ready_campaign(client, factory, 2)

    started = client.post(f"/api/campaigns/{campaign['id']}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "RUNNING"

    first = auto_sender.run_once()
    assert first["status"] == "sent"
    assert first["sent"] == 1
    running = client.get("/api/campaigns").json()[0]
    assert running["status"] == "RUNNING"
    assert running["counts"]["sent"] == 1

    throttled = auto_sender.run_once()
    assert throttled["status"] == "throttled"
    assert len(FakeGmail.sent) == 1

    second = auto_sender.run_once(now=datetime.now(timezone.utc) + timedelta(seconds=46))
    assert second["status"] == "sent"
    final = client.get("/api/campaigns").json()[0]
    assert final["status"] == "COMPLETED"
    assert final["counts"]["sent"] == 2
    assert final["progress"] == 100
    assert len(FakeGmail.sent) == 2


def test_auto_sender_pauses_at_daily_cap(client_factory, monkeypatch):
    client, factory = client_factory()
    monkeypatch.setattr(settings, "max_emails_per_day", 1)
    _, campaign = _ready_campaign(client, factory, 2)
    assert client.post(f"/api/campaigns/{campaign['id']}/start").status_code == 200

    assert auto_sender.run_once()["sent"] == 1
    capped = auto_sender.run_once()
    assert capped["status"] == "daily_cap"

    paused = client.get("/api/campaigns").json()[0]
    assert paused["status"] == "PAUSED"
    assert "Daily sending cap" in paused["last_error"]
    assert paused["counts"]["sent"] == 1


def test_auto_sender_retries_transient_failures(client_factory):
    client, factory = client_factory()
    _, campaign = _ready_campaign(client, factory, 1)
    assert client.post(f"/api/campaigns/{campaign['id']}/start").status_code == 200
    FakeGmail.failures.append(TimeoutError("temporary outage"))

    retried = auto_sender.run_once()
    assert retried["status"] == "retried"
    assert retried["retried"] == 1
    waiting = client.get("/api/campaigns").json()[0]
    assert waiting["status"] == "RUNNING"
    assert waiting["entries"][0]["state"] == "QUEUED"
    assert waiting["entries"][0]["attempts"] == 1
    assert "temporary outage" in waiting["entries"][0]["error"]
    assert waiting["next_send_at"]

    sent = auto_sender.run_once(now=datetime.now(timezone.utc) + timedelta(seconds=61))
    assert sent["status"] == "sent"
    final = client.get("/api/campaigns").json()[0]
    assert final["counts"]["sent"] == 1
    assert final["entries"][0]["attempts"] == 2


def test_auto_sender_pauses_on_terminal_failure(client_factory):
    client, factory = client_factory()
    _, campaign = _ready_campaign(client, factory, 1)
    assert client.post(f"/api/campaigns/{campaign['id']}/start").status_code == 200
    FakeGmail.failures.append(ValueError("bad send payload"))

    failed = auto_sender.run_once()
    assert failed["status"] == "failed"
    assert failed["failed"] == 1

    paused = client.get("/api/campaigns").json()[0]
    assert paused["status"] == "PAUSED"
    assert "send failure" in paused["last_error"]
    assert paused["entries"][0]["state"] == "FAILED"
    assert paused["entries"][0]["draft_status"] == "FAILED"
    assert paused["counts"]["failed"] == 1


def test_start_rejects_dry_run(client_factory, monkeypatch):
    client, factory = client_factory()
    _, campaign = _ready_campaign(client, factory, 1)
    monkeypatch.setattr(settings, "dry_run", True)

    response = client.post(f"/api/campaigns/{campaign['id']}/start")
    assert response.status_code == 409
    assert "Dry-run" in response.json()["detail"]
