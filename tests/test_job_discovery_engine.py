import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from app.db import session as db_session
from app.db.models import Base
from app.services import audit, auth as auth_service, outreach as outreach_service, profile_service
from app.services import job_discovery_engine
from app.services.job_sources import parse_experience, parse_salary


@pytest.fixture
def client_factory(monkeypatch, tmp_path):
    database = Path(tempfile.mkdtemp(prefix="jr-discovery-")) / "test.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    modules = (
        db_session,
        audit,
        auth_service,
        outreach_service,
        profile_service,
        main,
    )
    for module in modules:
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(main, "init_db", lambda: None)
    return lambda: TestClient(main.app)


def _signup(client, email="student@discovery.example"):
    result = client.post("/api/auth/register", json={
        "name": "Discovery Student",
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


def _sample_jobs():
    return [
        {
            "company_name": "Portal Co",
            "title": "Junior Python Developer",
            "location": "Remote",
            "description": "Python, FastAPI and machine learning for entry level engineers.",
            "url": "https://example.com/jobs/python-1",
            "apply_url": "https://example.com/jobs/python-1",
            "source": "remotive",
            "source_url": "https://remotive.com/api/remote-jobs",
            "salary_text": "$80,000 - $120,000 a year",
            "posted_at": "2026-11-18T10:00:00Z",
            "remote": True,
            "fingerprint": "python-job-fingerprint",
        },
        {
            "company_name": "Other Co",
            "title": "Senior Java Engineer",
            "location": "Berlin",
            "description": "Java and Spring Boot with Kubernetes.",
            "url": "https://example.com/jobs/java-1",
            "apply_url": "https://example.com/jobs/java-1",
            "source": "arbeitnow",
            "source_url": "https://www.arbeitnow.com/api/job-board-api",
            "salary_text": "€70k",
            "posted_at": "2026-11-17T10:00:00Z",
            "fingerprint": "java-job-fingerprint",
        },
    ]


def test_salary_and_experience_parsing():
    assert parse_salary("$80,000 - $120,000 a year")[:2] == (80000, 120000)
    assert parse_salary("80k - 120k")[:2] == (80000, 120000)
    assert parse_experience("Junior Python Developer with 1-2 years experience") == "ENTRY"
    assert parse_experience("Fresher machine learning engineer") == "FRESHER"


def test_discovery_filters_and_persists_portal_jobs(client_factory, monkeypatch):
    client = client_factory()
    _signup(client)
    monkeypatch.setattr(job_discovery_engine, "collect_jobs", lambda owner_id, filters: (_sample_jobs(), []))

    response = client.post("/api/jobs/discover", json={
        "skills": ["Python"],
        "location": "Remote",
        "salary_min": 50000,
        "sources": ["remotive"],
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["new_jobs"] == 1
    assert payload["total_found"] == 2
    job = payload["jobs"][0]
    assert job["contact_id"] is None
    assert job["salary_min"] == 80000
    assert job["salary_currency"] == "USD"
    assert job["remote"] is True
    assert job["experience_level"] == "ENTRY"

    filtered = client.get("/api/jobs", params={"skills": "Python", "salary_min": 50000}).json()
    assert filtered["total"] == 1
    assert filtered["jobs"][0]["title"] == "Junior Python Developer"

    blocked = client.get("/api/jobs", params={"experience": "SENIOR"}).json()
    assert blocked["total"] == 0


def test_job_alert_notifies_once_for_new_jobs(client_factory, monkeypatch):
    client = client_factory()
    _signup(client)
    monkeypatch.setattr(job_discovery_engine, "collect_jobs", lambda owner_id, filters: (_sample_jobs(), []))

    created = client.post("/api/job-alerts", json={
        "name": "Python roles",
        "skills": "Python",
        "sources": ["remotive"],
    })
    assert created.status_code == 200
    alert_id = created.json()["id"]

    first = client.post(f"/api/job-alerts/{alert_id}/run")
    assert first.status_code == 200
    assert first.json()["notifications"] == 1

    second = client.post(f"/api/job-alerts/{alert_id}/run")
    assert second.status_code == 200
    assert second.json()["new_jobs"] == 0
    assert second.json()["notifications"] == 0

    notifications = client.get("/api/job-notifications").json()
    assert len(notifications) == 1
    assert notifications[0]["alert_name"] == "Python roles"
    assert client.get("/api/job-notifications/unread-count").json()["count"] == 1

    assert client.post(f"/api/job-notifications/{notifications[0]['id']}/read").status_code == 200
    assert client.get("/api/job-notifications/unread-count").json()["count"] == 0
