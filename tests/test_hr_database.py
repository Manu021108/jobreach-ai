import pytest

from app.config import settings
from app.services import hr_database


CSV = """company_name,email,hr_name,role,location,industry,verified
Acme Corp,hr@acme.example,Asha,Talent Lead,Hyderabad,IT,false
Acme Corp,hr@acme.example,Asha,Talent Lead,Hyderabad,IT,false
Globex,people@globex.example,Ravi,Recruiter,Bengaluru,IT,true
Initech,jobs@initech.example,Meera,Engineering Manager,Hyderabad,Software,true
"""


@pytest.fixture
def dataset(monkeypatch, tmp_path):
    path = tmp_path / "hr_database.csv"
    path.write_text(CSV, encoding="utf-8")
    monkeypatch.setattr(settings, "hr_database_file", str(path))
    hr_database._load.cache_clear()
    yield path
    hr_database._load.cache_clear()


def test_query_records_filters_and_paginates(dataset):
    first_page = hr_database.query_records(query="hyderabad", limit=1, offset=0)
    assert first_page["total"] == 3
    assert first_page["filtered_total"] == 2
    assert first_page["verified_total"] == 3
    assert first_page["page_count"] == 2
    assert first_page["rows"][0]["company_name"] == "Acme Corp"

    second_page = hr_database.query_records(query="hyderabad", limit=1, offset=1)
    assert second_page["rows"][0]["company_name"] == "Initech"

    by_company = hr_database.query_records(company="globex")
    assert by_company["filtered_total"] == 1
    assert by_company["rows"][0]["email"] == "people@globex.example"

    by_role = hr_database.query_records(role="recruiter")
    assert by_role["filtered_total"] == 1
    assert by_role["rows"][0]["company_name"] == "Globex"

    unverified = hr_database.query_records(verified=False)
    assert unverified["filtered_total"] == 0
    assert unverified["rows"] == []


def test_preview_hides_emails_and_marks_verified(dataset):
    preview = hr_database.preview(2)
    assert len(preview) == 2
    assert all(set(item) == {"company_name", "role", "verified"} for item in preview)
    assert preview[0]["verified"] is True
    assert preview[0]["role"] == "Talent Lead"


def test_import_records_respects_filters_and_limit(dataset):
    rows = hr_database.import_records(limit=1, query="hyderabad")
    assert len(rows) == 1
    assert rows[0]["company_name"] == "Acme Corp"
    assert rows[0]["verified"] is True
