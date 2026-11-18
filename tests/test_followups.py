from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import main
from app.config import settings
from app.db import session as db_session
from app.db.models import AuditLog, Base, Contact, EmailDraft, OutreachEvent
from app.services import audit
from app.services import auth as auth_service
from app.services import billing as billing_service
from app.services import compliance
from app.services import followups as followup_service
from app.services import gmail_tokens
from app.services import outreach as outreach_service
from app.services import profile_service


class FakeGmail:
    def __init__(self, messages):
        self.messages = messages

    def list_recent_inbox(self, max_results=100):
        return [{"id": message["id"]} for message in self.messages]

    def get_message(self, message_id):
        return next(message for message in self.messages if message["id"] == message_id)


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    database = tmp_path / "followups.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    for module in (db_session, audit, auth_service, billing_service, gmail_tokens, outreach_service, profile_service, followup_service, main):
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(profile_service, "profile_dict", lambda owner_id: {
        "full_name": "Test Student",
        "email": "student@followups.example",
        "summary": "",
        "skills": "",
        "target_roles": "",
        "phone": "",
        "location": "",
        "linkedin": "",
        "github": "",
        "resume_name": None,
    })
    monkeypatch.setattr(gmail_tokens, "connection_status", lambda owner_id: {
        "connected": False, "email": "", "expires_at": None, "needs_reconnect": False,
    })
    monkeypatch.setattr(settings, "followup_max_per_run", 5)
    return lambda: (TestClient(main.app), factory)


def _signup(client, email="student@followups.example"):
    result = client.post("/api/auth/register", json={
        "name": "Follow Up Student",
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


def _sent_contact(factory, owner_id, due_days=-1):
    with factory() as db:
        contact = Contact(
            company_name="Acme",
            email="hr@acme.example",
            hr_name="Hiring Team",
            role="Python Developer",
            owner_id=owner_id,
        )
        db.add(contact)
        db.commit()
        contact_id = contact.id
    draft_id = outreach_service.save_draft(contact_id, "Python role at Acme", "Original body", owner_id=owner_id)
    outreach_service.approve_draft(draft_id, owner_id)
    outreach_service.mark_sent(draft_id, "msg-1", "thread-1", owner_id=owner_id)
    with factory() as db:
        event = db.scalar(select(OutreachEvent).where(OutreachEvent.draft_id == draft_id))
        event.followup_due_at = datetime.now(timezone.utc) + timedelta(days=due_days)
        db.commit()
        return contact_id, draft_id, event.id


def test_due_followup_creates_draft_and_sent_followup_completes_reminder(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    contact_id, original_draft_id, event_id = _sent_contact(factory, user["id"])

    result = followup_service.run_once(owner_id=user["id"])
    assert result == {"generated": 1, "skipped": 0}
    assert followup_service.run_once(owner_id=user["id"])["generated"] == 0

    with factory() as db:
        event = db.get(OutreachEvent, event_id)
        draft = db.get(EmailDraft, event.followup_draft_id)
        assert draft.status == "DRAFT"
        assert draft.subject == "Re: Python role at Acme"
        assert "follow up" in draft.body.lower()
        assert db.get(Contact, contact_id).status == "SENT"
        followup_draft_id = draft.id

    outreach_service.approve_draft(followup_draft_id, user["id"])
    outreach_service.mark_sent(followup_draft_id, "msg-2", "thread-1", owner_id=user["id"])

    with factory() as db:
        original = db.get(OutreachEvent, event_id)
        followup_sent = db.scalar(select(OutreachEvent).where(
            OutreachEvent.draft_id == followup_draft_id,
            OutreachEvent.event_type == "SENT",
        ))
        assert original.completed is True
        assert followup_sent.followup_due_at is None


def test_inbox_sync_marks_replies_and_opt_outs(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    contact_id, _, _ = _sent_contact(factory, user["id"])
    gmail = FakeGmail([{
        "id": "msg-reply",
        "threadId": "thread-1",
        "snippet": "Please unsubscribe me from this list.",
        "payload": {"headers": [
            {"name": "From", "value": "Acme HR <hr@acme.example>"},
            {"name": "Subject", "value": "Re: Python role at Acme"},
        ]},
    }])

    result = outreach_service.sync_inbox_best_effort(gmail, user["id"])
    assert result == {"matched": 1, "replies": 0, "opt_outs": 1}

    with factory() as db:
        contact = db.get(Contact, contact_id)
        event = db.scalar(select(OutreachEvent).where(OutreachEvent.contact_id == contact_id, OutreachEvent.event_type == "OPTED_OUT"))
        sent_event = db.scalar(select(OutreachEvent).where(OutreachEvent.contact_id == contact_id, OutreachEvent.event_type == "SENT"))
        assert contact.status == "OPTED_OUT"
        assert contact.opted_out is True
        assert event is not None
        assert sent_event.completed is True

    assert outreach_service.sync_inbox_best_effort(gmail, user["id"])["matched"] == 0


def test_inbox_sync_marks_non_opt_out_reply(client_factory):
    client, factory = client_factory()
    user = _signup(client, "reply@followups.example")
    contact_id, _, _ = _sent_contact(factory, user["id"])
    gmail = FakeGmail([{
        "id": "msg-reply",
        "threadId": "thread-1",
        "snippet": "Thanks for reaching out. Can we talk next week?",
        "payload": {"headers": [
            {"name": "From", "value": "Acme HR <hr@acme.example>"},
            {"name": "Subject", "value": "Re: Python role at Acme"},
        ]},
    }])

    result = outreach_service.sync_inbox_best_effort(gmail, user["id"])
    assert result == {"matched": 1, "replies": 1, "opt_outs": 0}

    with factory() as db:
        contact = db.get(Contact, contact_id)
        assert contact.status == "REPLIED"
        assert contact.opted_out is False


def test_dashboard_reports_due_followups_and_opt_outs(client_factory):
    client, factory = client_factory()
    user = _signup(client, "dashboard@followups.example")
    _sent_contact(factory, user["id"])
    with factory() as db:
        contact = Contact(
            company_name="Opt Out Co",
            email="hr@optout.example",
            status="OPTED_OUT",
            opted_out=True,
            owner_id=user["id"],
        )
        db.add(contact)
        db.commit()

    body = client.get("/api/dashboard").json()
    assert body["followups"]["due"] == 1
    assert body["stats"]["opted_out"] == 1
    assert body["stats"]["opened"] is None
    assert body["stats"]["remaining_today"] == max(0, body["daily_cap"] - body["sent_today"])


def test_unsubscribe_link_opts_out_contact_and_logs(client_factory):
    client, factory = client_factory()
    user = _signup(client, "unsubscribe@followups.example")
    contact_id, _, _ = _sent_contact(factory, user["id"])

    with factory() as db:
        contact = db.get(Contact, contact_id)
        url = compliance.unsubscribe_url(contact, user["id"])
        body = compliance.with_opt_out("Hello there", contact, user["id"])
        assert "/api/unsubscribe?token=" in url
        assert url in body
        assert "unsubscribe" in body.lower()

    response = client.get(f"/api/unsubscribe?token={url.split('token=', 1)[1]}")
    assert response.status_code == 200
    assert "unsubscribed" in response.text.lower()

    with factory() as db:
        contact = db.get(Contact, contact_id)
        sent_event = db.scalar(select(OutreachEvent).where(
            OutreachEvent.contact_id == contact_id,
            OutreachEvent.event_type == "SENT",
        ))
        logs = list(db.scalars(select(AuditLog)).all())
        assert contact.status == "OPTED_OUT"
        assert contact.opted_out is True
        assert sent_event.completed is True
        assert any(log.action == "UNSUBSCRIBE_LINK_USED" for log in logs)

    audit_body = client.get("/api/audit").json()
    assert any(item["action"] == "UNSUBSCRIBE_LINK_USED" for item in audit_body)


def test_per_user_dry_run_toggle(client_factory):
    client, _ = client_factory()
    _signup(client, "dryrun@followups.example")

    enabled = client.put("/api/settings/dry-run", json={"dry_run": True})
    assert enabled.status_code == 200
    assert enabled.json()["dry_run"] is True
    assert client.get("/api/settings").json()["dry_run"] is True
    assert client.get("/api/dashboard").json()["dry_run"] is True

    disabled = client.put("/api/settings/dry-run", json={"dry_run": False})
    assert disabled.status_code == 200
    assert disabled.json()["dry_run"] is False
    assert client.get("/api/settings").json()["dry_run"] is False
    assert client.get("/api/dashboard").json()["dry_run"] is False
