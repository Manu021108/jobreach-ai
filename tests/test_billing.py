import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from app.config import settings
from app.db import session as db_session
from app.db.models import Base
from app.services import auth as auth_service
from app.services import billing as billing_service
from app.services import gmail_tokens, hr_database
from app.services import outreach as outreach_service
from app.services import profile_service


DATABASE_ROWS = [
    {
        "company_name": "Acme Corp",
        "email": "hr@acme.example",
        "hr_name": "Asha",
        "role": "Talent Lead",
    },
    {
        "company_name": "Globex",
        "email": "people@globex.example",
        "hr_name": "Ravi",
        "role": "Recruiter",
    },
]


class FakeStripe:
    def __init__(self):
        self.created_sessions = []
        self.checkout = SimpleNamespace(Session=SimpleNamespace(create=self.create_session))
        self.Webhook = SimpleNamespace(construct_event=self.construct_event)

    def create_session(self, **kwargs):
        session = {
            "id": f"cs_test_{len(self.created_sessions) + 1}",
            "url": "https://checkout.stripe.test/session",
            "amount_total": 29900,
            "currency": "inr",
        }
        record = dict(session)
        record.update({key: kwargs[key] for key in ("mode", "client_reference_id", "metadata") if key in kwargs})
        self.created_sessions.append(record)
        return session

    def construct_event(self, payload, signature, secret):
        if signature != "valid":
            raise ValueError("bad signature")
        return json.loads(payload)


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    database = tmp_path / "billing.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    modules = (
        db_session, auth_service, gmail_tokens, outreach_service, profile_service,
        billing_service, main,
    )
    for module in modules:
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(hr_database, "total_count", lambda: len(DATABASE_ROWS))
    monkeypatch.setattr(hr_database, "preview", lambda limit=3: [{"company_name": item["company_name"]} for item in DATABASE_ROWS[:limit]])
    monkeypatch.setattr(hr_database, "search", lambda query="", limit=50, offset=0: DATABASE_ROWS[offset:offset + limit])
    monkeypatch.setattr(hr_database, "import_records", lambda limit=None: DATABASE_ROWS[:limit] if limit else DATABASE_ROWS)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(settings, "stripe_price_id", "")
    monkeypatch.setattr(settings, "stripe_unlock_amount", 29900)
    monkeypatch.setattr(settings, "stripe_unlock_currency", "inr")
    return lambda: (TestClient(main.app), FakeStripe())


def _signup(client, email="student@billing.example"):
    result = client.post("/api/auth/register", json={
        "name": "Billing Student",
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


def _webhook(event_id, event_type, session_object):
    return json.dumps({
        "id": event_id,
        "type": event_type,
        "data": {"object": session_object},
    }).encode()


def _send_webhook(client, event):
    return client.post("/api/billing/webhook", content=event, headers={"stripe-signature": "valid"})


def test_checkout_webhook_and_entitlement_gate_database(client_factory, monkeypatch):
    client, stripe = client_factory()
    monkeypatch.setattr(billing_service, "_client", lambda: stripe)
    user = _signup(client)

    settings_response = client.get("/api/settings").json()
    assert settings_response["hr_database_unlocked"] is False
    assert settings_response["hr_database_count"] == 2

    locked = client.get("/api/hr-database").json()
    assert locked["unlocked"] is False
    assert locked["total"] == 2
    assert locked["preview"] == [{"company_name": "Acme Corp"}, {"company_name": "Globex"}]
    assert "rows" not in locked
    assert client.post("/api/hr-database/import", json={"limit": 10}).status_code == 402

    checkout = client.post("/api/billing/checkout")
    assert checkout.status_code == 200
    session_id = checkout.json()["session_id"]
    assert checkout.json()["url"] == "https://checkout.stripe.test/session"
    assert stripe.created_sessions[0]["metadata"]["user_id"] == str(user["id"])

    invalid = client.post("/api/billing/webhook", content=b"{}", headers={"stripe-signature": "bad"})
    assert invalid.status_code == 400

    paid_event = _webhook("evt_paid", "checkout.session.completed", {
        "id": session_id,
        "client_reference_id": str(user["id"]),
        "metadata": {"user_id": str(user["id"]), "purpose": billing_service.HR_DATABASE},
        "amount_total": 29900,
        "currency": "inr",
        "payment_status": "paid",
        "payment_intent": "pi_test_1",
    })
    assert _send_webhook(client, paid_event).json()["processed"] is True
    duplicate = _send_webhook(client, paid_event)
    assert duplicate.json()["duplicate"] is True

    unlocked = client.get("/api/hr-database").json()
    assert unlocked["unlocked"] is True
    assert unlocked["rows"] == DATABASE_ROWS
    assert client.post("/api/billing/checkout").status_code == 409

    imported = client.post("/api/hr-database/import", json={"limit": 10})
    assert imported.status_code == 200
    assert imported.json()["added"] == 2
    assert len(client.get("/api/contacts").json()) == 2


def test_refund_revokes_entitlement(client_factory, monkeypatch):
    client, stripe = client_factory()
    monkeypatch.setattr(billing_service, "_client", lambda: stripe)
    user = _signup(client, "refund@billing.example")
    session_id = client.post("/api/billing/checkout").json()["session_id"]

    paid_event = _webhook("evt_refund_flow", "checkout.session.completed", {
        "id": session_id,
        "client_reference_id": str(user["id"]),
        "metadata": {"user_id": str(user["id"])},
        "amount_total": 29900,
        "currency": "inr",
        "payment_status": "paid",
        "payment_intent": "pi_refund_test",
    })
    assert _send_webhook(client, paid_event).status_code == 200
    assert client.get("/api/billing/entitlement").json()["unlocked"] is True

    refund_event = _webhook("evt_refunded", "charge.refunded", {
        "id": "ch_test_1",
        "payment_intent": "pi_refund_test",
        "refunded": True,
    })
    assert _send_webhook(client, refund_event).status_code == 200
    assert client.get("/api/billing/entitlement").json()["unlocked"] is False
    assert client.post("/api/hr-database/import", json={"limit": 10}).status_code == 402


def test_checkout_returns_503_when_payments_are_not_configured(client_factory, monkeypatch):
    client, _ = client_factory()
    def unavailable():
        raise billing_service.BillingError("Payments are not configured.")

    monkeypatch.setattr(billing_service, "_client", unavailable)
    _signup(client, "unconfigured@billing.example")
    response = client.post("/api/billing/checkout")
    assert response.status_code == 503
    assert response.json()["detail"] == "Payments are not configured."
