from functools import lru_cache
from math import ceil
from pathlib import Path

import pandas as pd

from app.config import settings


CANDIDATES = (
    "data/hr_database.csv",
    "data/4000_HrMails - Sheet1.csv",
    "data/jobreach_company_contacts.xlsx",
)


def _resolve_path():
    configured = settings.path(settings.hr_database_file)
    if configured.exists():
        return configured
    for candidate in CANDIDATES:
        path = settings.path(candidate)
        if path.exists():
            return path
    return configured


def _pick(row, *keys):
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _contains(item, needle, fields):
    return any(needle in str(item.get(field, "")).lower() for field in fields)


@lru_cache(maxsize=8)
def _load(path_name, modified, size):
    path = Path(path_name)
    if not path.exists() or size == 0:
        return ()
    if path.suffix.lower() in {".xlsx", ".xls"}:
        frame = pd.read_excel(path, dtype=str, keep_default_na=False)
    else:
        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        columns = {str(column).strip().lower() for column in frame.columns}
        if "email" not in columns:
            frame = pd.read_csv(path, skiprows=2, dtype=str, keep_default_na=False)
    frame.columns = [str(column).strip().lower() for column in frame.columns]
    records = []
    seen = set()
    for row in frame.to_dict(orient="records"):
        email = _pick(row, "email", "emails", "hr email", "contact email").lower()
        company = _pick(row, "company_name", "company name", "company", "organisation", "organization")
        if "@" not in email or not company or email in seen:
            continue
        seen.add(email)
        records.append({
            "company_name": company[:200],
            "email": email[:320],
            "hr_name": _pick(row, "hr_name", "hr name", "person name", "name")[:200] or "Hiring Team",
            "role": _pick(row, "role", "designation", "title")[:200] or "Relevant Opportunities",
            "location": _pick(row, "location", "city", "country")[:200],
            "industry": _pick(row, "industry", "sector")[:200],
            "source": _pick(row, "source", "source_url", "website")[:320],
            "verified": True,
        })
    return tuple(records)


def rows():
    path = _resolve_path()
    stat = path.stat() if path.exists() else None
    return list(_load(str(path), stat.st_mtime_ns if stat else 0, stat.st_size if stat else 0))


def total_count():
    return len(rows())


def verified_count():
    return sum(1 for item in rows() if item["verified"])


def preview(limit=3):
    return [
        {
            "company_name": item["company_name"],
            "role": item["role"],
            "verified": item["verified"],
        }
        for item in rows()[:limit]
    ]


def query_records(query="", company="", role="", verified=None, limit=50, offset=0):
    items = rows()
    needle = str(query or "").strip().lower()
    company_filter = str(company or "").strip().lower()
    role_filter = str(role or "").strip().lower()
    if needle:
        items = [item for item in items if _contains(item, needle, ("company_name", "email", "hr_name", "role", "location", "industry"))]
    if company_filter:
        items = [item for item in items if company_filter in item["company_name"].lower()]
    if role_filter:
        items = [item for item in items if role_filter in item["role"].lower()]
    if verified is not None:
        wanted = verified if isinstance(verified, bool) else str(verified).strip().lower() in {"1", "true", "yes", "verified"}
        items = [item for item in items if item["verified"] is wanted]
    total = len(items)
    start = max(0, int(offset or 0))
    size = max(0, int(limit or 0))
    return {
        "rows": items[start:start + size] if size else items[start:],
        "total": len(rows()),
        "filtered_total": total,
        "verified_total": verified_count(),
        "page_count": ceil(total / size) if size else (1 if total else 0),
    }


def search(query="", limit=50, offset=0):
    return query_records(query=query, limit=limit, offset=offset)["rows"]


def import_records(limit=None, query="", company="", role="", verified=None):
    return query_records(
        query=query,
        company=company,
        role=role,
        verified=verified,
        limit=limit,
        offset=0,
    )["rows"]
