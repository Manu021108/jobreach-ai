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
