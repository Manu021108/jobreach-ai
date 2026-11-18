from functools import lru_cache
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
        })
    return tuple(records)


def rows():
    path = _resolve_path()
    stat = path.stat() if path.exists() else None
    return list(_load(str(path), stat.st_mtime_ns if stat else 0, stat.st_size if stat else 0))


def total_count():
    return len(rows())


def preview(limit=3):
    return [{"company_name": item["company_name"]} for item in rows()[:limit]]


def search(query="", limit=50, offset=0):
    needle = str(query or "").strip().lower()
    items = rows()
    if needle:
        items = [
            item for item in items
            if any(needle in str(item.get(field, "")).lower() for field in ("company_name", "email", "hr_name", "role"))
        ]
    return items[offset:offset + limit]


def import_records(limit=None):
    items = rows()
    return items if limit is None else items[:limit]
