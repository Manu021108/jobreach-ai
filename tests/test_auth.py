import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from app.db import session as db_session
from app.db.models import Base
from app.services import auth as auth_service
from app.services import outreach as outreach_service


@pytest.fixture
def client_factory(monkeypatch):
    database = Path(tempfile.mkdtemp(prefix="jr-auth-")) / "test.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    monkeypatch.setattr(db_session, "SessionLocal", factory)
    monkeypatch.setattr(auth_service, "SessionLocal", factory)
    monkeypatch.setattr(outreach_service, "SessionLocal", factory)
    monkeypatch.setattr(main, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    return lambda: TestClient(main.app)


def test_registration_verification_login_logout_reset_and_isolation(client_factory):
    outreach_service.add_contacts([{"company_name": "Legacy Corp", "email": "hr@legacy.example"}])
    student_a, student_b = client_factory(), client_factory()

    first = student_a.post("/api/auth/register", json={
        "name": "Student One", "email": "one@example.com", "password": "oldpassword1",
    }).json()
    second = student_b.post("/api/auth/register", json={
        "name": "Student Two", "email": "two@example.com", "password": "oldpassword1",
    }).json()
    assert first["email_sent"] is False
    assert student_a.post("/api/auth/login", json={
        "email": "one@example.com", "password": "oldpassword1",
    }).status_code == 200
    assert student_a.get("/api/auth/me").json()["is_verified"] is False
    assert student_a.get("/api/dashboard").status_code == 403

    assert student_a.post("/api/auth/verify-email", json={
        "token": first["dev_verification_token"],
    }).status_code == 200
    assert student_b.post("/api/auth/verify-email", json={
        "token": second["dev_verification_token"],
    }).status_code == 200

    login_a = student_a.post("/api/auth/login", json={
        "email": "one@example.com", "password": "oldpassword1",
    })
    login_b = student_b.post("/api/auth/login", json={
        "email": "two@example.com", "password": "oldpassword1",
    })
    assert login_a.status_code == 200
    assert student_a.get("/api/auth/me").json()["email"] == "one@example.com"

    outreach_service.add_contacts(
        [{"company_name": "A Corp", "email": "hr@a.example"}], owner_id=login_a.json()["id"],
    )
    outreach_service.add_contacts(
        [{"company_name": "B Corp", "email": "hr@b.example"}], owner_id=login_b.json()["id"],
    )
    assert {row["company_name"] for row in student_a.get("/api/contacts").json()} == {
        "Legacy Corp", "A Corp",
    }
    assert {row["company_name"] for row in student_b.get("/api/contacts").json()} == {"B Corp"}

    reset = student_a.post("/api/auth/reset-request", json={"email": "one@example.com"}).json()
    assert student_a.post("/api/auth/reset-confirm", json={
        "token": reset["dev_reset_token"], "password": "newpassword1",
    }).status_code == 200

    assert student_a.post("/api/auth/logout").status_code == 200
    assert student_a.get("/api/auth/me").status_code == 401
    assert student_a.post("/api/auth/login", json={
        "email": "one@example.com", "password": "oldpassword1",
    }).status_code == 401
    assert student_a.post("/api/auth/login", json={
        "email": "one@example.com", "password": "newpassword1",
    }).status_code == 200


def _signup(client, name, email):
    result = client.post("/api/auth/register", json={
        "name": name, "email": email, "password": "studentpass1",
    }).json()
    assert client.post("/api/auth/verify-email", json={
        "token": result["dev_verification_token"],
    }).status_code == 200
    login = client.post("/api/auth/login", json={
        "email": email, "password": "studentpass1",
    })
    assert login.status_code == 200
    return login.json()


def test_contacts_drafts_jobs_events_and_campaigns_are_owner_scoped(client_factory):
    student_a, student_b = client_factory(), client_factory()
    user_a = _signup(student_a, "Student A", "a@isolation.example")
    user_b = _signup(student_b, "Student B", "b@isolation.example")

    for owner_id, company in ((user_a["id"], "A Corp"), (user_b["id"], "B Corp")):
        outreach_service.add_contacts(
            [{"company_name": company, "email": f"hr@{company.split()[0].lower()}.example"}],
            owner_id=owner_id,
        )
    outreach_service.add_contacts(
        [{"company_name": "Shared Corp", "email": "hr@shared.example"}], owner_id=user_a["id"],
    )
    outreach_service.add_contacts(
        [{"company_name": "Shared Corp", "email": "hr@shared.example"}], owner_id=user_b["id"],
    )

    contact_a = next(c for c in outreach_service.get_contacts(owner_id=user_a["id"]) if c.company_name == "A Corp")
    contact_b = next(c for c in outreach_service.get_contacts(owner_id=user_b["id"]) if c.company_name == "B Corp")
    outreach_service.save_jobs(contact_a.id, [{"url": "https://a.example/job", "title": "A Role"}], user_a["id"])
    outreach_service.save_jobs(contact_b.id, [{"url": "https://b.example/job", "title": "B Role"}], user_b["id"])
    job_a = outreach_service.get_jobs(contact_a.id, user_a["id"])[0]
    job_b = outreach_service.get_jobs(contact_b.id, user_b["id"])[0]

    draft_a = outreach_service.save_draft(contact_a.id, "A subject", "A body", job_a.id, user_a["id"])
    draft_b = outreach_service.save_draft(contact_b.id, "B subject", "B body", job_b.id, user_b["id"])
    for draft_id, owner_id in ((draft_a, user_a["id"]), (draft_b, user_b["id"])):
        outreach_service.approve_draft(draft_id, owner_id)
        outreach_service.mark_sent(draft_id, f"msg-{owner_id}", f"thread-{owner_id}", owner_id=owner_id)
    event_a = outreach_service.get_followups(owner_id=user_a["id"])[0]
    event_b = outreach_service.get_followups(owner_id=user_b["id"])[0]

    assert {c["company_name"] for c in student_a.get("/api/contacts").json()} == {"A Corp", "Shared Corp"}
    assert {c["company_name"] for c in student_b.get("/api/contacts").json()} == {"B Corp", "Shared Corp"}
    assert {d["subject"] for d in student_a.get("/api/drafts").json()} == {"A subject"}
    assert {d["subject"] for d in student_b.get("/api/drafts").json()} == {"B subject"}
    assert [f["id"] for f in student_a.get("/api/followups").json()] == [event_a.id]
    assert [f["id"] for f in student_b.get("/api/followups").json()] == [event_b.id]

    dashboard_a = student_a.get("/api/dashboard").json()
    assert dashboard_a["stats"]["contacts"] == 2
    assert dashboard_a["stats"]["sent"] == 1
    assert {c["company_name"] for c in dashboard_a["recent_contacts"]} == {"A Corp", "Shared Corp"}

    assert student_a.get(f"/api/contacts/{contact_b.id}/jobs").status_code == 404
    assert student_a.post(f"/api/jobs/{job_b.id}/match").status_code == 404
    assert student_a.post(f"/api/jobs/{job_b.id}/generate").status_code == 404
    assert student_a.post(f"/api/jobs/{job_b.id}/drafts", json={"subject": "x", "body": "y"}).status_code == 404
    assert student_a.put(f"/api/contacts/{contact_b.id}/status", json={"status": "ARCHIVED"}).status_code == 404
    assert student_a.put(f"/api/contacts/{contact_b.id}/context", json={"company_context": "x"}).status_code == 404
    assert student_a.put(f"/api/contacts/{contact_b.id}/website", json={"website": "https://example.com"}).status_code == 404
    assert student_a.post(f"/api/contacts/{contact_b.id}/generate", json={"company_context": "x"}).status_code == 404
    assert student_a.post(f"/api/contacts/{contact_b.id}/jobs/discover").status_code == 404
    assert student_a.post(f"/api/contacts/{contact_b.id}/drafts", json={"subject": "x", "body": "y"}).status_code == 404
    assert student_a.put(f"/api/drafts/{draft_b}", json={"subject": "x", "body": "y"}).status_code == 404
    assert student_a.post(f"/api/drafts/{draft_b}/approve").status_code == 404
    assert student_a.get(f"/api/drafts/{draft_b}/preview").status_code == 404
    assert student_a.post(f"/api/drafts/{draft_b}/send", json={
        "reviewed": True, "typed_recipient": "hr@bcorp.example",
    }).status_code == 404
    assert student_a.post(f"/api/followups/{event_b.id}/complete").status_code == 404

    imported = student_a.post("/api/contacts/import", files={
        "file": ("shared.csv", b"company_name,email\nB Corp,hr@bcorp.example\n", "text/csv"),
    })
    assert imported.status_code == 200
    assert imported.json()["added"] == 1
    assert "B Corp" in {c["company_name"] for c in student_a.get("/api/contacts").json()}
