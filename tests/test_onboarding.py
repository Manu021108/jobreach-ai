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
from app.services import gmail_tokens
from app.services import outreach as outreach_service
from app.services import profile_service


PDF = b"%PDF-1.4\n%test pdf\n"


@pytest.fixture
def client_factory(monkeypatch):
    database = Path(tempfile.mkdtemp(prefix="jr-profile-")) / "test.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    for module in (db_session, auth_service, gmail_tokens, outreach_service, profile_service, main):
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(profile_service, "claim_legacy_resume", lambda user_id: None)
    return lambda: TestClient(main.app)


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


def _profile(name, skills):
    return {
        "full_name": name,
        "phone": "9876543210",
        "location": "Hyderabad, India",
        "linkedin": f"https://linkedin.com/in/{name.lower().replace(' ', '-')}",
        "github": "",
        "summary": f"{name} builds web applications with Django and React.",
        "skills": skills,
        "target_roles": "Web Developer, Django Developer",
    }


def test_onboarding_profile_and_resume_are_private_and_editable(client_factory):
    student_a, student_b = client_factory(), client_factory()
    user_a = _signup(student_a, "Student A", "a@profile.example")
    user_b = _signup(student_b, "Student B", "b@profile.example")

    assert student_a.get("/api/auth/me").json()["onboarding_completed"] is False
    assert student_b.get("/api/auth/me").json()["onboarding_completed"] is False

    saved_a = student_a.put("/api/profile", json=_profile("Anita Sharma", "Django, React"))
    assert saved_a.status_code == 200
    assert saved_a.json()["user"]["name"] == "Anita Sharma"
    assert saved_a.json()["onboarding"]["profile_complete"] is True

    uploaded_a = student_a.post("/api/profile/resume", files={
        "file": ("anita_resume.pdf", PDF, "application/pdf"),
    })
    assert uploaded_a.status_code == 200
    assert uploaded_a.json()["resume_name"] == "anita_resume.pdf"
    assert uploaded_a.json()["onboarding"]["completed"] is True
    assert student_a.get("/api/auth/me").json()["onboarding_completed"] is True

    saved_b = student_b.put("/api/profile", json=_profile("Bhanu Rao", "FastAPI, SQL"))
    assert saved_b.status_code == 200
    assert student_b.get("/api/settings").json()["skills"] == "FastAPI, SQL"
    assert student_b.get("/api/settings").json()["resume_name"] is None
    assert student_b.get("/api/auth/me").json()["onboarding_completed"] is False

    uploaded_b = student_b.post("/api/settings/resume", files={
        "file": ("bhanu resume.pdf", PDF, "application/pdf"),
    })
    assert uploaded_b.status_code == 200
    assert uploaded_b.json()["resume_name"] == "bhanu_resume.pdf"
    assert student_b.get("/api/auth/me").json()["onboarding_completed"] is True

    profile_a = student_a.get("/api/profile").json()
    profile_b = student_b.get("/api/profile").json()
    assert profile_a["full_name"] == "Anita Sharma"
    assert profile_a["skills"] == "Django, React"
    assert profile_a["resume_name"] == "anita_resume.pdf"
    assert profile_b["full_name"] == "Bhanu Rao"
    assert profile_b["skills"] == "FastAPI, SQL"
    assert profile_b["resume_name"] == "bhanu_resume.pdf"

    assert profile_service.get_resume(user_b["id"]).filename == "bhanu_resume.pdf"
    assert profile_service.get_resume(user_a["id"]).content == PDF

    removed = student_b.delete("/api/profile/resume")
    assert removed.status_code == 200
    assert removed.json()["resume_name"] is None
    assert profile_service.get_resume(user_a["id"]) is not None
    assert student_a.get("/api/settings").json()["resume_name"] == "anita_resume.pdf"


def test_profile_requires_complete_onboarding_before_complete_endpoint(client_factory):
    student = client_factory()
    _signup(student, "Partial Profile", "partial@profile.example")
    student.put("/api/profile", json=_profile("Partial Profile", "Django"))
    response = student.post("/api/onboarding/complete")
    assert response.status_code == 409
    assert "resume" in response.json()["detail"].lower()
