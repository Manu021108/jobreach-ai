import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
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


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    database = tmp_path / "pagination.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    modules = (
        db_session, audit, auth_service, gmail_tokens, outreach_service,
        profile_service, campaign_service, main,
    )
    for module in modules:
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    return lambda: (TestClient(main.app), factory)


def _signup(client, email="pagination@example.com"):
    result = client.post("/api/auth/register", json={
        "name": "Pagination Student",
        "email": email,
        "password": "studentpass1",
    }).json()
    assert client.post("/api/auth/verify-email", json={
        "token": result["dev_verification_token"],
    }).status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": "studentpass1"})
    assert login.status_code == 200
    return login.json()


def _add(factory, owner_id, company_name, **overrides):
    values = {
        "company_name": company_name,
        "email": f"{uuid.uuid4().hex}@example.com",
        "hr_name": "Hiring Team",
        "role": "Relevant Opportunities",
        "location": "",
        "website": "",
        "company_context": "",
        "job_url": "",
        "source_url": "",
        "notes": "",
        "status": "PENDING",
        "opted_out": False,
        "created_at": datetime(2026, 1, 1),
        "updated_at": datetime(2026, 1, 1),
    }
    values.update(overrides)
    with factory() as db:
        contact = Contact(owner_id=owner_id, **values)
        db.add(contact)
        db.commit()
        db.refresh(contact)
        return contact.id


def test_legacy_endpoint_keeps_bare_array_and_status_filter(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    contact_id = _add(factory, user["id"], "Legacy Corp")
    expected = main._contact_dict(outreach_service.get_contact(contact_id, user["id"]))

    response = client.get("/api/contacts")

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert response.json() == [expected]
    assert client.get("/api/contacts", params={"status": "All"}).json() == [expected]
    assert client.get("/api/contacts", params={"status": "PENDING"}).json() == [expected]
    assert client.get("/api/contacts", params={"status": "SENT"}).json() == []
    assert client.get("/api/contacts", params={"status": "INVALID"}).status_code == 400


def test_paged_shape_and_serialization(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    first = _add(factory, user["id"], "Acme Corp", email="acme@example.com")
    second = _add(factory, user["id"], "Globex Corp", email="globex@example.com")

    response = client.get("/api/contacts/paged")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "rows", "total", "unfiltered_total", "page", "page_size",
        "page_count", "status_counts",
    }
    assert body["rows"] == [
        main._contact_dict(outreach_service.get_contact(second, user["id"])),
        main._contact_dict(outreach_service.get_contact(first, user["id"])),
    ]
    assert body["total"] == 2
    assert body["unfiltered_total"] == 2
    assert body["page"] == 1
    assert body["page_size"] == 25
    assert body["page_count"] == 1
    assert client.get("/api/contacts/paged", params={"status": "INVALID"}).status_code == 400


def test_paged_q_status_and_eligible_filters(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    owner = user["id"]
    alice = _add(factory, owner, "Alpha Labs", hr_name="Recruiter Alice", role="Engineer",
                 location="Berlin", website="https://alpha.example", email="alpha@example.com")
    bob = _add(factory, owner, "Beta Corp", hr_name="Bob", role="Designer",
               location="Paris", website="https://beta.example", email="beta@example.com",
               status="DRAFTED")
    failed = _add(factory, owner, "Gamma Inc", status="FAILED")
    sent = _add(factory, owner, "Delta Ltd", status="SENT")
    opted_out = _add(factory, owner, "Epsilon Co", opted_out=True)

    def ids(**params):
        return [row["id"] for row in client.get("/api/contacts/paged", params=params).json()["rows"]]

    assert ids(q="ALICE") == [alice]
    assert ids(q="designer") == [bob]
    assert ids(q="paris") == [bob]
    assert ids(q="beta.example") == [bob]
    assert ids(q="alpha@example.com") == [alice]
    assert set(ids(status="PENDING")) == {alice, opted_out}
    assert set(ids(eligible="true")) == {alice, bob, failed}
    assert set(ids(eligible="true", status="DRAFTED")) == {bob}
    assert ids(eligible="true", status="SENT") == []
    assert len(ids(eligible="false")) == 5
    assert sent not in ids(eligible="true")


def test_paged_sorts_are_allowlisted_and_stable(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    owner = user["id"]
    base = datetime(2026, 1, 1)
    early = datetime(2025, 1, 1)
    late = datetime(2027, 1, 1)
    zebra = _add(factory, owner, "Zebra Co", status="SENT", created_at=base, updated_at=base)
    alpha_pending = _add(factory, owner, "Alpha Co", status="PENDING", created_at=base, updated_at=base)
    alpha_drafted = _add(factory, owner, "Alpha Co", status="DRAFTED", created_at=early, updated_at=late)
    beta = _add(factory, owner, "Beta Co", status="PENDING", created_at=late, updated_at=base)

    def ids(sort):
        return [row["id"] for row in client.get(
            "/api/contacts/paged", params={"sort": sort, "page_size": 100},
        ).json()["rows"]]

    assert ids("recent") == [alpha_drafted, beta, alpha_pending, zebra]
    assert ids("created") == [beta, alpha_pending, zebra, alpha_drafted]
    assert ids("oldest") == [alpha_drafted, zebra, alpha_pending, beta]
    assert ids("company") == [alpha_pending, alpha_drafted, beta, zebra]
    assert ids("status") == [alpha_drafted, alpha_pending, beta, zebra]
    assert ids("not-a-sort") == ids("recent")


def test_paged_page_normalization_and_beyond_range(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    for company in ("One Co", "Two Co", "Three Co"):
        _add(factory, user["id"], company)

    first = client.get("/api/contacts/paged", params={"page": 0, "page_size": 0}).json()
    assert first["page"] == 1
    assert first["page_size"] == 1
    assert first["total"] == 3
    assert first["page_count"] == 3
    assert len(first["rows"]) == 1

    capped = client.get("/api/contacts/paged", params={"page": -5, "page_size": 1000}).json()
    assert capped["page"] == 1
    assert capped["page_size"] == 100
    assert capped["page_count"] == 1
    assert len(capped["rows"]) == 3

    beyond = client.get("/api/contacts/paged", params={"page": 99, "page_size": 25}).json()
    assert beyond["rows"] == []
    assert beyond["page"] == 99
    assert beyond["page_size"] == 25
    assert beyond["total"] == 3
    assert beyond["page_count"] == 1


def test_status_counts_and_unfiltered_total_use_other_filters_only(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    owner = user["id"]
    search_pending = _add(factory, owner, "Search Co", status="PENDING")
    search_sent = _add(factory, owner, "Search Co", status="SENT")
    search_failed = _add(factory, owner, "Search Co", status="FAILED")
    other_pending = _add(factory, owner, "Other Co", status="PENDING")
    _add(factory, owner, "Other Co", status="DRAFTED", opted_out=True)
    _add(factory, 999999, "Search Co", status="PENDING")

    def body(**params):
        return client.get("/api/contacts/paged", params=params).json()

    assert set(body()["status_counts"]) == {"All", *main._all_statuses}
    assert body()["total"] == 5
    assert body()["unfiltered_total"] == 5
    assert body()["status_counts"]["All"] == 5
    assert body()["status_counts"]["PENDING"] == 2
    assert body()["status_counts"]["SENT"] == 1
    assert body()["status_counts"]["FAILED"] == 1

    searched = body(q="Search Co")
    assert searched["total"] == 3
    assert searched["unfiltered_total"] == 5
    assert searched["status_counts"]["All"] == 3
    assert searched["status_counts"]["PENDING"] == 1
    assert searched["status_counts"]["SENT"] == 1
    assert searched["status_counts"]["FAILED"] == 1

    eligible = body(eligible="true")
    assert eligible["total"] == 3
    assert {row["id"] for row in eligible["rows"]} == {
        search_pending, search_failed, other_pending,
    }
    assert eligible["status_counts"]["All"] == 3
    assert eligible["status_counts"]["PENDING"] == 2
    assert eligible["status_counts"]["DRAFTED"] == 0
    assert eligible["status_counts"]["SENT"] == 0

    filtered = body(q="Search Co", eligible="true", status="PENDING", page_size=1)
    assert filtered["total"] == 1
    assert filtered["page_count"] == 1
    assert filtered["status_counts"]["All"] == 2
    assert filtered["status_counts"]["PENDING"] == 1
    assert filtered["status_counts"]["FAILED"] == 1
    assert [row["id"] for row in filtered["rows"]] == [search_pending]


def test_ownership_isolation_lookup_and_single_get(client_factory):
    client_a, factory = client_factory()
    user_a = _signup(client_a, "owner-a@example.com")
    first = _add(factory, user_a["id"], "A One Corp")
    second = _add(factory, user_a["id"], "A Two Corp")
    client_b, _ = client_factory()
    user_b = _signup(client_b, "owner-b@example.com")
    foreign = _add(factory, user_b["id"], "B One Corp")

    assert [row["id"] for row in client_a.get("/api/contacts/paged").json()["rows"]] == [second, first]
    assert [row["id"] for row in client_b.get("/api/contacts/paged").json()["rows"]] == [foreign]

    lookup = client_a.post("/api/contacts/lookup", json={
        "ids": [foreign, second, 999999, first],
    })
    assert lookup.status_code == 200
    assert lookup.json() == {"rows": [
        main._contact_dict(outreach_service.get_contact(second, user_a["id"])),
        main._contact_dict(outreach_service.get_contact(first, user_a["id"])),
    ]}
    assert client_a.post("/api/contacts/lookup", json={"ids": []}).json() == {"rows": []}
    capped = client_a.post("/api/contacts/lookup", json={
        "ids": [900000 + value for value in range(250)] + [first],
    })
    assert capped.status_code == 200
    assert capped.json() == {"rows": []}

    assert client_a.get(f"/api/contacts/{first}").json() == main._contact_dict(
        outreach_service.get_contact(first, user_a["id"])
    )
    assert client_a.get(f"/api/contacts/{foreign}").status_code == 404
    assert client_a.get("/api/contacts/999999").status_code == 404
    assert client_b.get(f"/api/contacts/{first}").status_code == 404
    assert client_b.post("/api/contacts/lookup", json={"ids": [first]}).json() == {"rows": []}


def test_like_metacharacters_are_escaped(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    percent = _add(factory, user["id"], "100% Corp")
    underscore = _add(factory, user["id"], "Under_score Ltd")
    backslash = _add(factory, user["id"], "Back\\Slash Co")
    _add(factory, user["id"], "Ordinary Co")

    def ids(q):
        return [row["id"] for row in client.get(
            "/api/contacts/paged", params={"q": q},
        ).json()["rows"]]

    assert ids("100%") == [percent]
    assert ids("%") == [percent]
    assert ids("_") == [underscore]
    assert ids("\\") == [backslash]
    assert ids("  100%  ") == [percent]


def test_dashboard_recent_contacts_are_limited_and_stable(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    owner = user["id"]
    base = datetime(2026, 1, 1)
    for index in range(25):
        updated = base + timedelta(days=index - 19) if index >= 20 else base
        _add(factory, owner, f"Recent Co {index:02d}", created_at=base, updated_at=updated)

    with factory() as db:
        expected = list(db.scalars(
            select(Contact.id)
            .where(Contact.owner_id == owner)
            .order_by(Contact.updated_at.desc(), Contact.id.desc())
            .limit(15)
        ).all())
        full = list(db.scalars(
            select(Contact.id)
            .where(Contact.owner_id == owner)
            .order_by(Contact.updated_at.desc(), Contact.id.desc())
        ).all())

    response = client.get("/api/dashboard")

    assert response.status_code == 200
    rows = response.json()["recent_contacts"]
    assert [row["id"] for row in rows] == expected
    assert len(rows) == 15
    assert [contact.id for contact in outreach_service.recent_contacts(owner, 0)] == full[:1]
    assert [contact.id for contact in outreach_service.recent_contacts(owner, 500)] == full


def test_analytics_uses_aggregates_with_many_contacts(client_factory):
    client, factory = client_factory()
    user = _signup(client)
    owner = user["id"]
    statuses = (
        ["PENDING"] * 40 + ["REPLIED"] * 7 + ["OPTED_OUT"] * 5
        + ["DRAFTED"] * 3 + ["SENT"] * 2
    )
    for index, status in enumerate(statuses):
        _add(factory, owner, f"Analytics Co {index:02d}", status=status, opted_out=status == "OPTED_OUT")
    for index in range(4):
        _add(factory, 999999, f"Foreign Analytics Co {index:02d}", status="REPLIED", opted_out=True)

    response = client.get("/api/analytics", params={"days": 7})

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["contacts"] == len(statuses)
    assert body["totals"]["replies"] == 7
    assert body["totals"]["opted_out"] == 5
    assert body["pipeline"] == {
        "PENDING": 40, "REPLIED": 7, "OPTED_OUT": 5, "DRAFTED": 3, "SENT": 2,
    }
    dashboard = client.get("/api/dashboard").json()["stats"]
    assert dashboard["contacts"] == body["totals"]["contacts"]
    assert dashboard["replies"] == body["totals"]["replies"]
    assert dashboard["opted_out"] == body["totals"]["opted_out"]
