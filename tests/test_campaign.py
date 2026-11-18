import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from app.db import session as db_session
from app.db.models import Base, Contact
from app.services import audit
from app.services import auth as auth_service
from app.services import campaign as campaign_service
from app.services import gmail_tokens
from app.services import outreach as outreach_service
from app.services import profile_service


class FakeWriter:
    def __init__(self, profile):
        self.profile = profile

    def generate(self, contact, resume_filename):
        if contact.email.startswith("fail@"):
            raise RuntimeError("generation failed")
        return {
            "subject": f"Hello {contact.company_name}",
            "body": f"Body for {contact.email}",
        }


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    database = tmp_path / "campaign.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    modules = (
        db_session, audit, auth_service, gmail_tokens, outreach_service, profile_service,
        campaign_service, main,
    )
    for module in modules:
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(campaign_service, "AIWriter", FakeWriter)
    return lambda: (TestClient(main.app), factory)


def _signup(client, email="student@campaign.example"):
    result = client.post("/api/auth/register", json={
        "name": "Campaign Student",
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


def _add_contacts(factory, owner_id):
    with factory() as db:
        contacts = [
            Contact(company_name="Acme", email="hr@acme.example", role="Recruiter", owner_id=owner_id),
            Contact(company_name="Globex", email="people@globex.example", role="Talent Lead", owner_id=owner_id),
            Contact(company_name="Failure Co", email="fail@example.com", role="Hiring Team", owner_id=owner_id),
            Contact(company_name="Opted Out", email="out@example.com", role="Hiring Team", owner_id=owner_id, opted_out=True),
            Contact(company_name="Already Sent", email="sent@example.com", role="Hiring Team", owner_id=owner_id, status="SENT"),
            Contact(company_name="Other Owner", email="other@example.com", role="Hiring Team", owner_id=99999),
        ]
        db.add_all(contacts)
        db.commit()
        return [contact.id for contact in contacts]


def test_campaign_builder_generates_approves_edits_and_queues(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    acme, globex, failing, opted_out, sent, other_owner = _add_contacts(factory, user["id"])

    generated = client.post("/api/campaigns/generate", json={
        "contact_ids": [acme, globex, failing, opted_out, sent, other_owner],
    })
    assert generated.status_code == 200
    body = generated.json()
    assert body["generated"] == 2
    assert body["failed"] == 1
    assert body["failures"][0]["contact_id"] == failing

    campaigns = client.get("/api/campaigns").json()
    assert len(campaigns) == 1
    campaign = campaigns[0]
    assert campaign["counts"]["total"] == 3
    assert campaign["counts"]["generated"] == 2
    assert campaign["counts"]["failed"] == 1
    assert {entry["company_name"] for entry in campaign["entries"]} == {"Acme", "Globex", "Failure Co"}
    generated_ids = [entry["draft_id"] for entry in campaign["entries"] if entry["state"] == "GENERATED"]
    assert len(generated_ids) == 2

    approved = client.post(f"/api/campaigns/{campaign['id']}/approve", json={
        "draft_ids": generated_ids,
    })
    assert approved.status_code == 200
    assert approved.json() == {"approved": 2, "errors": []}

    edited = client.put(f"/api/drafts/{generated_ids[0]}", json={
        "subject": "Updated subject",
        "body": "Updated body",
    })
    assert edited.status_code == 200
    after_edit = client.get("/api/campaigns").json()[0]
    assert after_edit["counts"]["approved"] == 1
    edited_entry = next(entry for entry in after_edit["entries"] if entry["draft_id"] == generated_ids[0])
    assert edited_entry["state"] == "DRAFT"

    reapproved = client.post(f"/api/campaigns/{campaign['id']}/approve", json={
        "draft_ids": [generated_ids[0]],
    })
    assert reapproved.json()["approved"] == 1

    queued = client.post(f"/api/campaigns/{campaign['id']}/queue")
    assert queued.status_code == 200
    assert queued.json() == {"queued": 2}

    final = client.get("/api/campaigns").json()[0]
    assert final["status"] == "QUEUED"
    assert final["counts"]["approved"] == 0
    assert final["counts"]["queued"] == 2
    assert final["counts"]["failed"] == 1
    assert client.post(f"/api/campaigns/{campaign['id']}/queue").status_code == 409


def test_campaigns_are_isolated_by_owner(client_factory):
    client, factory = client_factory()
    owner = _signup(client)
    acme, *_ = _add_contacts(factory, owner["id"])
    generated = client.post("/api/campaigns/generate", json={"contact_ids": [acme]}).json()
    campaign = client.get("/api/campaigns").json()[0]
    draft_id = campaign["entries"][0]["draft_id"]

    other, _ = client_factory()
    _signup(other, "other@campaign.example")
    assert other.get("/api/campaigns").json() == []
    assert other.post(f"/api/campaigns/{campaign['id']}/approve", json={
        "draft_ids": [draft_id],
    }).status_code == 404
    assert other.post(f"/api/campaigns/{campaign['id']}/queue").status_code == 404
    assert generated["generated"] == 1
