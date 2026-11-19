import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from sqlalchemy import select

from app.config import settings
from app.db import session as db_session
from app.db.models import Contact
from app.services import job_discovery
from app.utils import company_slug, domain_label, normalize_website, website_from_email

PORTAL_SOURCES = ("remotive", "arbeitnow", "remoteok")
COMPANY_SOURCES = ("greenhouse", "lever", "careers_page")
SOURCE_LABELS = {
    "remotive": "Remotive",
    "arbeitnow": "Arbeitnow",
    "remoteok": "RemoteOK",
    "greenhouse": "Greenhouse",
    "lever": "Lever",
    "careers_page": "Career sites",
}
HEADERS = {"User-Agent": "JobReachAI/1.0 (job discovery)"}


def clean_text(value):
    return job_discovery._clean(value)


def parse_datetime(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = clean_text(value)
    if not text:
        return None
    if text.isdigit() and len(text) >= 9:
        try:
            return datetime.fromtimestamp(int(text), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_salary(value):
    text = clean_text(value).lower()
    if not text:
        return None, None, "", ""
    currency_match = re.search(r"\b(usd|inr|eur|gbp|cad|aud)\b", text)
    if currency_match:
        currency = currency_match.group(1).upper()
    elif "₹" in text or "rs" in text:
        currency = "INR"
    elif "€" in text:
        currency = "EUR"
    elif "£" in text:
        currency = "GBP"
    elif "cad" in text or "c$" in text:
        currency = "CAD"
    elif "aud" in text or "a$" in text:
        currency = "AUD"
    else:
        currency = "USD"
    period = "year"
    if re.search(r"\b(hour|hourly|per hour|/hr)\b", text):
        period = "hour"
    elif re.search(r"\b(month|monthly|per month|/mo)\b", text):
        period = "month"
    elif re.search(r"\b(week|weekly|per week|/wk)\b", text):
        period = "week"
    matches = re.findall(r"(\d+(?:[.,]\d+)?)\s*([km])?\b", text.replace(",", ""))
    amounts = []
    for number, suffix in matches:
        amount = float(number)
        if suffix == "k":
            amount *= 1000
        elif suffix == "m":
            amount *= 1_000_000
        amounts.append((int(amount), suffix))
    if not amounts:
        return None, None, "", ""
    has_multiplier = any(suffix for _, suffix in amounts)
    values = [
        amount * 1000 if has_multiplier and not suffix and amount < 1000 else amount
        for amount, suffix in amounts
    ]
    values = [value for value in values if value >= 100]
    if len(values) >= 2:
        return min(values), max(values), currency, period
    return values[0], values[0], currency, period


def parse_experience(text):
    value = clean_text(text).lower()
    if re.search(r"\b(fresher|freshers|new grad|new graduate|0\s*[-+]?\s*[12]?\s*years?)\b", value):
        return "FRESHER"
    if re.search(r"\b(entry[- ]level|junior|associate|1\s*[-+]?\s*[23]?\s*years?)\b", value):
        return "ENTRY"
    if re.search(r"\b(senior|lead|principal|staff|5\s*\+?\s*years?)\b", value):
        return "SENIOR"
    if re.search(r"\b(mid[- ]level|3\s*[-+]?\s*[45]?\s*years?|4\s*\+?\s*years?)\b", value):
        return "MID"
    return "UNKNOWN"


def parse_employment_type(text):
    value = clean_text(text).lower()
    for label, pattern in (
        ("Internship", r"\bintern(ship)?\b"),
        ("Contract", r"\b(contract|freelance|temporary)\b"),
        ("Part-time", r"\bpart[- ]time\b"),
        ("Full-time", r"\bfull[- ]time\b"),
    ):
        if re.search(pattern, value):
            return label
    return ""


def is_remote(location, text):
    value = f"{location or ''} {text or ''}".lower()
    return bool(re.search(r"\b(remote|anywhere|work from home|wfh|distributed)\b", value))


def make_fingerprint(company, title, url):
    parsed = urlparse(str(url or ""))
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith(("utm_", "ref", "source", "fbclid", "gclid"))
    ]
    normalized = urlunparse((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        parsed.path.rstrip("/"),
        "",
        urlencode(sorted(query)),
        "",
    ))
    raw = f"{clean_text(company).lower()}|{clean_text(title).lower()}|{normalized}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def normalize_job(item):
    url = clean_text(item.get("url") or item.get("apply_url"))
    if not url:
        return None
    title = clean_text(item.get("title")) or "Open Role"
    company = clean_text(item.get("company_name") or item.get("company")) or "Unknown company"
    description = clean_text(item.get("description"))[:20000]
    location = clean_text(item.get("location"))[:200]
    salary_min = item.get("salary_min")
    salary_max = item.get("salary_max")
    salary_currency = clean_text(item.get("salary_currency"))[:10]
    salary_period = clean_text(item.get("salary_period"))[:20]
    if salary_min is None and salary_max is None:
        salary_text = item.get("salary") or item.get("salary_text") or ""
        parsed_min, parsed_max, parsed_currency, parsed_period = parse_salary(salary_text)
        salary_min, salary_max = parsed_min, parsed_max
        salary_currency = salary_currency or parsed_currency
        salary_period = salary_period or parsed_period
    experience = clean_text(item.get("experience_level"))[:30].upper() or parse_experience(f"{title} {description}")
    employment_type = clean_text(item.get("employment_type"))[:50] or parse_employment_type(
        f"{title} {item.get('job_type') or ''} {description}"
    )
    source = clean_text(item.get("source") or "portal")[:50]
    source_url = clean_text(item.get("source_url") or url)[:1000]
    evidence = clean_text(item.get("evidence")) or job_discovery._evidence(
        source_url, url, 200, source, item.get("signal") or "public-listing"
    )
    return {
        "company_name": company[:200],
        "title": title[:300],
        "location": location,
        "description": description,
        "url": url[:1000],
        "apply_url": clean_text(item.get("apply_url") or url)[:1000],
        "source": source,
        "source_url": source_url,
        "active": item.get("active") is not False,
        "evidence": evidence[:20000],
        "posted_at": parse_datetime(item.get("posted_at")),
        "salary_min": int(salary_min) if salary_min is not None else None,
        "salary_max": int(salary_max) if salary_max is not None else None,
        "salary_currency": salary_currency,
        "salary_period": salary_period,
        "experience_level": experience,
        "employment_type": employment_type,
        "remote": bool(item.get("remote")) or is_remote(location, f"{title} {description}"),
        "fingerprint": clean_text(item.get("fingerprint"))[:64] or make_fingerprint(company, title, url),
        "contact_id": item.get("contact_id"),
    }


def fetch_json(url):
    with httpx.Client(
        timeout=settings.job_discovery_timeout_seconds,
        follow_redirects=True,
        headers=HEADERS,
    ) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.json()


def fetch_remotive(limit):
    url = "https://remotive.com/api/remote-jobs"
    data = fetch_json(url)
    jobs = []
    for item in data.get("jobs", [])[:limit]:
        jobs.append(normalize_job({
            "company_name": item.get("company_name"),
            "title": item.get("title"),
            "location": item.get("candidate_required_location") or "Remote",
            "description": item.get("description"),
            "url": item.get("url"),
            "apply_url": item.get("url"),
            "source": "remotive",
            "source_url": url,
            "salary": item.get("salary"),
            "employment_type": item.get("job_type"),
            "posted_at": item.get("publication_date") or item.get("date_posted"),
            "remote": True,
            "signal": "remotive-public-api",
        }))
    return [job for job in jobs if job]


def fetch_arbeitnow(limit):
    url = "https://www.arbeitnow.com/api/job-board-api"
    data = fetch_json(url)
    jobs = []
    for item in data.get("data", [])[:limit]:
        jobs.append(normalize_job({
            "company_name": item.get("company_name"),
            "title": item.get("title"),
            "location": "Remote" if item.get("remote") else item.get("location"),
            "description": item.get("description"),
            "url": item.get("url") or f"https://www.arbeitnow.com/jobs/{item.get('slug', '')}",
            "apply_url": item.get("url"),
            "source": "arbeitnow",
            "source_url": url,
            "posted_at": item.get("created_at"),
            "remote": bool(item.get("remote")),
            "employment_type": ", ".join(item.get("job_types") or []),
            "signal": "arbeitnow-public-api",
        }))
    return [job for job in jobs if job]


def fetch_remoteok(limit):
    url = "https://remoteok.com/api"
    data = fetch_json(url)
    jobs = []
    for item in data[1:limit + 1] if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        jobs.append(normalize_job({
            "company_name": item.get("company") or item.get("company_name"),
            "title": item.get("position") or item.get("title"),
            "location": item.get("location") or "Remote",
            "description": item.get("description"),
            "url": item.get("url") or item.get("apply_url") or item.get("guid"),
            "apply_url": item.get("apply_url") or item.get("url"),
            "source": "remoteok",
            "source_url": url,
            "salary_min": item.get("salary_min"),
            "salary_max": item.get("salary_max"),
            "posted_at": item.get("date") or item.get("epoch"),
            "tags": item.get("tags"),
            "remote": True,
            "signal": "remoteok-public-api",
        }))
    return [job for job in jobs if job]


def fetch_greenhouse(slug, company, limit):
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
    data = fetch_json(url)
    jobs = [normalize_job(item) for item in job_discovery._parse_greenhouse(data, company, url)[:limit]]
    return [job for job in jobs if job]


def fetch_lever(slug, company, limit):
    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    data = fetch_json(url)
    jobs = [normalize_job(item) for item in job_discovery._parse_lever(data, company, url)[:limit]]
    return [job for job in jobs if job]


def fetch_careers_page(contact, limit):
    website = normalize_website(contact.website) or website_from_email(contact.email)
    if not website:
        return []
    jobs = []
    for careers_url in job_discovery._careers_urls(website):
        try:
            response = job_discovery._get(careers_url)
            for href, _label in job_discovery._job_links(response.text, careers_url):
                raw = job_discovery.verify_job(href, contact.company_name, "careers_page", careers_url)
                raw.update({"contact_id": contact.id, "signal": "careers-page"})
                job = normalize_job(raw)
                if job:
                    jobs.append(job)
                if len(jobs) >= limit:
                    return jobs
        except Exception:
            continue
    return jobs


def selected_sources(values):
    if isinstance(values, str):
        values = [item.strip().lower() for item in values.split(",")]
    if not values:
        values = list(settings.job_discovery_portals.split(",")) + ["greenhouse", "lever", "careers_page"]
    allowed = set(PORTAL_SOURCES + COMPANY_SOURCES)
    return [value.strip().lower() for value in values if str(value).strip().lower() in allowed]


def collect_jobs(owner_id, filters):
    jobs = []
    warnings = []
    sources = selected_sources(filters.get("sources"))
    limit = max(1, min(int(settings.job_discovery_max_per_source), 100))
    for source in sources:
        try:
            if source == "remotive":
                jobs.extend(fetch_remotive(limit))
            elif source == "arbeitnow":
                jobs.extend(fetch_arbeitnow(limit))
            elif source == "remoteok":
                jobs.extend(fetch_remoteok(limit))
        except Exception as exc:
            warnings.append(f"{SOURCE_LABELS.get(source, source)} search unavailable: {type(exc).__name__}")

    if filters.get("include_companies", True) and any(source in COMPANY_SOURCES for source in sources):
        with db_session.SessionLocal() as db:
            statement = select(Contact).where(Contact.owner_id == int(owner_id))
            if filters.get("company"):
                statement = statement.where(Contact.company_name.ilike(f"%{filters['company'].strip()}%"))
            contacts = list(db.scalars(
                statement.order_by(Contact.company_name).limit(settings.job_discovery_max_companies)
            ).all())
        for contact in contacts:
            website = normalize_website(contact.website) or website_from_email(contact.email)
            slugs = [value for value in dict.fromkeys([
                company_slug(contact.company_name),
                domain_label(website),
            ]) if value][:2]
            for source in sources:
                try:
                    if source == "greenhouse":
                        for slug in slugs:
                            jobs.extend(fetch_greenhouse(slug, contact.company_name, limit))
                    elif source == "lever":
                        for slug in slugs:
                            jobs.extend(fetch_lever(slug, contact.company_name, limit))
                    elif source == "careers_page":
                        for job in fetch_careers_page(contact, limit):
                            job["contact_id"] = contact.id
                            jobs.append(job)
                except Exception as exc:
                    warnings.append(
                        f"{SOURCE_LABELS.get(source, source)} lookup for {contact.company_name} unavailable: {type(exc).__name__}"
                    )
                if len(jobs) >= limit * max(1, len(sources)) * 4:
                    break
            if len(jobs) >= limit * max(1, len(sources)) * 4:
                break
    return jobs, warnings
