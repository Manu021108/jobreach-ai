from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import or_, select

from app.config import settings
from app.db import session as db_session
from app.db.models import JobPosting
from app.services import audit, profile_service
from app.services.job_matcher import match_job
from app.services.job_sources import collect_jobs, normalize_job, parse_datetime, selected_sources


def _as_utc(value):
    if not value:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _as_list(value):
    if value is None or value == "":
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def normalize_filters(values):
    values = values or {}
    experience = []
    for item in _as_list(values.get("experience")):
        experience.extend(item.upper().split())
    sources = selected_sources(values.get("sources"))
    if values.get("source"):
        sources = selected_sources(values.get("source"))
    return {
        "query": str(values.get("query") or "").strip(),
        "company": str(values.get("company") or "").strip(),
        "skills": _as_list(values.get("skills")),
        "location": str(values.get("location") or "").strip(),
        "experience": list(dict.fromkeys(experience)),
        "salary_min": int(values["salary_min"]) if values.get("salary_min") not in (None, "", 0) else None,
        "fresher_only": bool(values.get("fresher_only")),
        "sources": sources,
        "include_companies": values.get("include_companies", True) is not False,
        "posted_within_days": int(values["posted_within_days"]) if values.get("posted_within_days") else None,
        "min_match_score": int(values["min_match_score"]) if values.get("min_match_score") else None,
        "sort": str(values.get("sort") or "newest").lower(),
    }


def job_payload(job):
    return {
        "id": job.id,
        "contact_id": job.contact_id,
        "company_name": job.company_name,
        "title": job.title,
        "location": job.location,
        "description": job.description,
        "url": job.url,
        "apply_url": job.apply_url,
        "source": job.source,
        "source_url": job.source_url,
        "active": job.active,
        "evidence": job.evidence,
        "match_score": job.match_score,
        "match_reasons": job.match_reasons,
        "verified_at": _as_utc(job.verified_at).isoformat() if job.verified_at else None,
        "posted_at": _as_utc(job.posted_at).isoformat() if job.posted_at else None,
        "salary_min": job.salary_min,
        "salary_max": job.salary_max,
        "salary_currency": job.salary_currency,
        "salary_period": job.salary_period,
        "experience_level": job.experience_level,
        "employment_type": job.employment_type,
        "remote": bool(job.remote),
        "fingerprint": job.fingerprint,
        "first_seen_at": _as_utc(job.first_seen_at).isoformat() if job.first_seen_at else None,
        "last_seen_at": _as_utc(job.last_seen_at).isoformat() if job.last_seen_at else None,
        "created_at": _as_utc(job.created_at).isoformat() if job.created_at else None,
        "contact_email": job.contact.email if job.contact else "",
        "contact_role": job.contact.role if job.contact else "",
    }


def matches_filters(job, filters):
    text = f"{job.get('title', '')} {job.get('company_name', '')} {job.get('description', '')}".lower()
    if filters["query"] and filters["query"].lower() not in text:
        return False
    if filters["company"] and filters["company"].lower() not in str(job.get("company_name", "")).lower():
        return False
    if filters["skills"] and not any(skill.lower() in text for skill in filters["skills"]):
        return False
    if filters["location"]:
        location = f"{job.get('location', '')} {'remote' if job.get('remote') else ''}".lower()
        if filters["location"].lower() not in location:
            return False
    experience = str(job.get("experience_level") or "UNKNOWN").upper()
    wanted = filters["experience"]
    if wanted and not any(
        level == "ALL" or level == experience or (level == "ENTRY" and experience == "FRESHER")
        for level in wanted
    ):
        return False
    if filters["salary_min"] is not None:
        salary_max = job.get("salary_max")
        salary_min = job.get("salary_min")
        if not salary_max and not salary_min:
            return False
        if max(int(salary_max or 0), int(salary_min or 0)) < filters["salary_min"]:
            return False
    if filters["fresher_only"] and not (
        experience in {"FRESHER", "ENTRY"}
        or any(term in text for term in ("fresher", "entry level", "entry-level", "new graduate", "junior"))
    ):
        return False
    if filters["sources"] and job.get("source") not in filters["sources"]:
        return False
    if filters["posted_within_days"]:
        posted = _as_utc(parse_datetime(job.get("posted_at")))
        cutoff = datetime.now(timezone.utc) - timedelta(days=filters["posted_within_days"])
        if not posted or posted < cutoff:
            return False
    return True


def _score_job(job, profile):
    result = match_job(
        SimpleNamespace(title=job.get("title", ""), description=job.get("description", "")),
        profile,
    )
    job["match_score"] = int(result["score"])
    job["match_reasons"] = "; ".join(result["reasons"][:4])
    return job


def _dedupe(jobs):
    unique = []
    seen = set()
    for job in jobs:
        keys = {
            job.get("fingerprint"),
            str(job.get("url") or "").lower().rstrip("/"),
        }
        keys.discard(None)
        keys.discard("")
        if keys and keys & seen:
            continue
        if keys:
            seen.update(keys)
        unique.append(job)
    return unique


def _sort_key(job):
    posted = _as_utc(parse_datetime(job.get("posted_at"))) or datetime.min.replace(tzinfo=timezone.utc)
    return (int(job.get("match_score") or 0), posted)


def persist_jobs(owner_id, jobs):
    if not jobs:
        return [], 0, 0
    now = datetime.now(timezone.utc)
    added = []
    updated = 0
    skipped = 0
    with db_session.SessionLocal() as db:
        fingerprints = [job.get("fingerprint") for job in jobs if job.get("fingerprint")]
        urls = [job.get("url") for job in jobs if job.get("url")]
        conditions = [JobPosting.owner_id == int(owner_id)]
        if fingerprints:
            conditions.append(JobPosting.fingerprint.in_(fingerprints))
        if urls:
            conditions.append(JobPosting.url.in_(urls))
        existing = list(db.scalars(select(JobPosting).where(or_(*conditions))).all())
        by_fingerprint = {row.fingerprint: row for row in existing if row.fingerprint}
        by_url = {row.url: row for row in existing}
        for item in jobs:
            row = by_fingerprint.get(item.get("fingerprint")) or by_url.get(item.get("url"))
            if not row:
                row = JobPosting(
                    owner_id=int(owner_id),
                    contact_id=item.get("contact_id"),
                    company_name=item.get("company_name", "Unknown company")[:200],
                    title=item.get("title", "Open Role")[:300],
                    location=item.get("location", "")[:200],
                    description=item.get("description", "")[:20000],
                    url=item.get("url", "")[:1000],
                    apply_url=item.get("apply_url") or item.get("url", "")[:1000],
                    source=item.get("source", "portal")[:50],
                    source_url=item.get("source_url", "")[:1000],
                    active=item.get("active") is not False,
                    evidence=item.get("evidence", "")[:20000],
                    match_score=item.get("match_score"),
                    match_reasons=item.get("match_reasons", "")[:20000],
                    verified_at=now,
                    posted_at=_as_utc(parse_datetime(item.get("posted_at"))),
                    salary_min=item.get("salary_min"),
                    salary_max=item.get("salary_max"),
                    salary_currency=item.get("salary_currency", "")[:10],
                    salary_period=item.get("salary_period", "")[:20],
                    experience_level=item.get("experience_level", "UNKNOWN")[:30],
                    employment_type=item.get("employment_type", "")[:50],
                    remote=bool(item.get("remote")),
                    fingerprint=item.get("fingerprint"),
                    first_seen_at=now,
                    last_seen_at=now,
                )
                db.add(row)
                db.flush()
                by_fingerprint[row.fingerprint] = row
                by_url[row.url] = row
                added.append(job_payload(row))
                continue
            changed = False
            if row.last_seen_at is None or row.last_seen_at < now:
                row.last_seen_at = now
                changed = True
            if item.get("active") is False and row.active:
                row.active = False
                changed = True
            if item.get("match_score") is not None and (
                row.match_score is None or int(item["match_score"]) > row.match_score
            ):
                row.match_score = int(item["match_score"])
                row.match_reasons = item.get("match_reasons", "")[:20000]
                changed = True
            for field in ("posted_at", "salary_min", "salary_max", "salary_currency", "salary_period", "experience_level", "employment_type", "fingerprint"):
                value = item.get(field)
                if value and getattr(row, field, None) in (None, "", 0):
                    setattr(row, field, value)
                    changed = True
            if changed:
                updated += 1
            else:
                skipped += 1
        db.commit()
    return added, updated, skipped


async def discover_for_owner(owner_id, values):
    filters = normalize_filters(values)
    profile = profile_service.ai_profile(int(owner_id))
    raw_jobs, warnings = await collect_jobs(int(owner_id), filters)
    candidates = []
    for raw_job in raw_jobs:
        job = normalize_job(raw_job)
        if not job or not matches_filters(job, filters):
            continue
        candidates.append(_score_job(job, profile))
    if filters["min_match_score"] is not None:
        candidates = [job for job in candidates if int(job.get("match_score") or 0) >= filters["min_match_score"]]
    candidates = _dedupe(candidates)
    candidates.sort(key=_sort_key, reverse=True)
    added, updated, skipped = persist_jobs(int(owner_id), candidates)
    unique_warnings = list(dict.fromkeys(warnings))[:12]
    result = {
        "total_found": len(raw_jobs),
        "matched": len(candidates),
        "new_jobs": len(added),
        "updated_jobs": updated,
        "duplicate_jobs": skipped,
        "warnings": unique_warnings,
        "sources": filters["sources"],
        "filters": filters,
        "jobs": added[:24],
    }
    audit.log(
        owner_id,
        "JOB_DISCOVERY_RUN",
        f"found={result['total_found']} matched={result['matched']} new={result['new_jobs']}",
    )
    return result
