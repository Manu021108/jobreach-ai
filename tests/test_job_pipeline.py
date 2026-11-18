import json
from types import SimpleNamespace

from app.services import job_discovery
from app.services.job_discovery import _parse_greenhouse, _parse_lever, verify_job
from app.services.job_matcher import match_job
from app.utils import website_from_email


def test_website_is_derived_from_email_domain():
    assert website_from_email("person@acme.com") == "https://acme.com"
    assert website_from_email("person@gmail.com") == ""
    assert website_from_email("person@acme.com", "acme.io/careers") == "https://acme.io/careers"


def test_greenhouse_api_results_include_evidence():
    data = {"jobs": [{
        "title": "Python Developer",
        "absolute_url": "https://boards.greenhouse.io/acme/jobs/1",
        "location": {"name": "Hyderabad"},
        "content": "<p>Python and ML</p>",
    }]}
    jobs = _parse_greenhouse(data, "Acme", "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true")
    assert jobs[0]["title"] == "Python Developer"
    assert jobs[0]["source"] == "greenhouse"
    assert "Python and ML" in jobs[0]["description"]
    assert json.loads(jobs[0]["evidence"])["signal"] == "greenhouse-public-api"


def test_lever_api_results_include_location():
    data = [{
        "text": "Data Engineer",
        "hostedUrl": "https://jobs.lever.co/acme/1",
        "categories": {"location": "Remote"},
        "descriptionPlain": "ETL and SQL",
    }]
    jobs = _parse_lever(data, "Acme", "https://api.lever.co/v0/postings/acme?mode=json")
    assert jobs[0]["location"] == "Remote"
    assert jobs[0]["source"] == "lever"


def test_verify_job_reads_json_ld_jobposting(monkeypatch):
    html = (
        '<html><head><title>Engineer</title>'
        '<script type="application/ld+json">'
        '{"@type":"JobPosting","title":"AI Engineer","url":"https://acme.com/jobs/7",'
        '"description":"Machine learning with Python",'
        '"jobLocation":{"address":{"addressLocality":"Pune"}},'
        '"hiringOrganization":{"name":"Acme"}}'
        '</script></head><body></body></html>'
    )
    response = SimpleNamespace(text=html, url="https://acme.com/jobs/7", status_code=200)
    monkeypatch.setattr(job_discovery, "_get", lambda url: response)
    job = verify_job("https://acme.com/jobs/7", "Acme")
    assert job["title"] == "AI Engineer"
    assert job["location"] == "Pune"
    assert json.loads(job["evidence"])["signal"] == "json-ld-jobposting"


def test_match_job_detects_python_ai_and_data_engineering():
    job = SimpleNamespace(
        title="Python Developer",
        description="Work with Python, machine learning, FastAPI and SQL data pipelines; ETL with Airflow.",
    )
    result = match_job(job)
    assert result["score"] > 0
    assert "Python" in result["matched"]
    assert "AI/ML" in result["matched"]
    assert "Data Engineering" in result["matched"]
