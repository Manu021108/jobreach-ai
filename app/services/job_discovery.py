import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from app.utils import company_slug, domain_label, normalize_website, website_from_email

TIMEOUT = 8
MAX_JOBS = 8
HEADERS = {"User-Agent": "JobReachAI/1.0 (local job outreach tool)"}


class _PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.title = ""
        self.heading = ""
        self.meta_description = ""
        self.json_ld = []
        self._title = False
        self._heading = False
        self._anchor = None
        self._script_type = ""

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "title":
            self._title = True
        elif tag == "h1":
            self._heading = True
        elif tag == "a" and attributes.get("href"):
            self._anchor = [attributes["href"], ""]
        elif tag == "script":
            self._script_type = attributes.get("type", "")
        elif tag == "meta" and attributes.get("name", "").lower() == "description":
            self.meta_description = attributes.get("content", "")

    def handle_data(self, data):
        if self._title:
            self.title += data
        if self._heading:
            self.heading += data
        if self._anchor is not None:
            self._anchor[1] += data
        if self._script_type == "application/ld+json":
            self.json_ld.append(data)

    def handle_endtag(self, tag):
        if tag == "title":
            self._title = False
        elif tag == "h1":
            self._heading = False
        elif tag == "a" and self._anchor is not None:
            self.links.append(tuple(self._anchor))
            self._anchor = None
        elif tag == "script":
            self._script_type = ""


def _clean(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(text or ""))).strip()


def _evidence(checked_url, final_url, status, source, signal):
    return json.dumps({
        "checked_url": checked_url,
        "final_url": str(final_url),
        "status_code": status,
        "source": source,
        "signal": signal,
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False)


def _get(url):
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS) as client:
        response = client.get(url)
        response.raise_for_status()
        return response


def _careers_urls(website):
    parsed = urlparse(normalize_website(website))
    base = f"{parsed.scheme or 'https'}://{parsed.netloc}"
    paths = ["careers", "jobs", "careers/jobs", "en/careers"]
    if parsed.path and parsed.path.strip("/"):
        paths.insert(0, parsed.path.strip("/"))
    return [f"{base}/{path}" for path in dict.fromkeys(paths)]


def _job_links(html, base_url):
    parser = _PageParser()
    try:
        parser.feed(html)
    except Exception:
        return []
    pattern = re.compile(r"career|jobs?|greenhouse|lever|workday|myworkdayjobs|apply|opening", re.I)
    links = []
    for href, label in parser.links:
        url = urljoin(base_url, href)
        if url.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        if not pattern.search(url) and not pattern.search(label):
            continue
        same_site = urlparse(url).netloc == urlparse(base_url).netloc
        if not same_site and not pattern.search(url):
            continue
        if url not in [item[0] for item in links]:
            links.append((url, _clean(label)))
    return links[:MAX_JOBS]


def _parse_greenhouse(data, company, source_url):
    jobs = []
    for item in data.get("jobs", [])[:MAX_JOBS]:
        url = str(item.get("absolute_url") or "").strip()
        if not url:
            continue
        jobs.append({
            "company_name": company,
            "title": _clean(item.get("title")) or "Open Role",
            "location": _clean((item.get("location") or {}).get("name")),
            "description": _clean(item.get("content"))[:12000],
            "url": url,
            "apply_url": url,
            "source": "greenhouse",
            "source_url": source_url,
            "active": True,
            "evidence": _evidence(source_url, url, 200, "greenhouse", "greenhouse-public-api"),
        })
    return jobs


def _parse_lever(data, company, source_url):
    jobs = []
    for item in data[:MAX_JOBS] if isinstance(data, list) else []:
        url = str(item.get("hostedUrl") or "").strip()
        if not url:
            continue
        categories = item.get("categories") or {}
        jobs.append({
            "company_name": company,
            "title": _clean(item.get("text")) or "Open Role",
            "location": _clean(categories.get("location")),
            "description": _clean(item.get("descriptionPlain") or item.get("description"))[:12000],
            "url": url,
            "apply_url": str(item.get("applyUrl") or url),
            "source": "lever",
            "source_url": source_url,
            "active": True,
            "evidence": _evidence(source_url, url, 200, "lever", "lever-public-api"),
        })
    return jobs


def _json_ld_job(parser, company, url, response):
    for block in parser.json_ld:
        try:
            data = json.loads(block)
        except (TypeError, ValueError):
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            types = node.get("@type", "")
            types = types if isinstance(types, list) else [types]
            if "JobPosting" not in types:
                continue
            location = node.get("jobLocation") or {}
            if isinstance(location, list):
                location = location[0] if location else {}
            address = location.get("address") or {}
            place = _clean(address.get("addressLocality") or location.get("name"))
            return {
                "company_name": _clean((node.get("hiringOrganization") or {}).get("name")) or company,
                "title": _clean(node.get("title")) or _clean(parser.title),
                "location": place,
                "description": _clean(node.get("description"))[:12000],
                "url": str(node.get("url") or response.url or url),
                "apply_url": str(node.get("url") or response.url or url),
                "active": True,
                "signal": "json-ld-jobposting",
            }
    return None


def verify_job(url, company, source="careers_page", checked_url=None):
    response = _get(url)
    parser = _PageParser()
    try:
        parser.feed(response.text)
    except Exception:
        pass
    job = _json_ld_job(parser, company, url, response)
    if job is None:
        title = _clean(parser.title).split(" | ")[0].split(" - ")[0] or _clean(parser.heading)
        job = {
            "company_name": company,
            "title": title or "Open Role",
            "location": "",
            "description": _clean(parser.meta_description),
            "url": str(response.url),
            "apply_url": str(response.url),
            "active": True,
            "signal": "page-title" if title else "meta-description",
        }
    combined = f"{job['title']} {job['description']}".lower()
    if any(phrase in combined for phrase in (
        "no longer available", "position has been filled", "this job has expired",
        "page not found", "404 error",
    )):
        job["active"] = False
    signal = job.pop("signal")
    job.update({
        "source": source,
        "source_url": checked_url or url,
        "evidence": _evidence(checked_url or url, job["url"], response.status_code, source, signal),
    })
    return job


def discover_jobs(contact):
    website = normalize_website(contact.website) or website_from_email(contact.email)
    if not website:
        return [], ["No company website found in the contact data; add one on the Job Match page."]

    warnings = []
    jobs = []
    slugs = [value for value in dict.fromkeys([
        company_slug(contact.company_name),
        domain_label(website),
    ]) if value][:2]
    for slug in slugs:
        candidates = [
            ("greenhouse", f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"),
            ("lever", f"https://api.lever.co/v0/postings/{slug}?mode=json"),
        ]
        for source, endpoint in candidates:
            try:
                response = _get(endpoint)
                data = response.json()
                parsed = _parse_greenhouse(data, contact.company_name, endpoint) if source == "greenhouse" else _parse_lever(data, contact.company_name, endpoint)
                jobs.extend(parsed)
            except Exception as exc:
                warnings.append(f"{source} lookup for '{slug}' unavailable: {type(exc).__name__}")
            if len(jobs) >= MAX_JOBS:
                break
        if len(jobs) >= MAX_JOBS:
            break

    if not jobs:
        for careers_url in _careers_urls(website):
            try:
                response = _get(careers_url)
                for href, _label in _job_links(response.text, careers_url):
                    try:
                        jobs.append(verify_job(href, contact.company_name, "careers_page", careers_url))
                    except Exception as exc:
                        warnings.append(f"Could not verify {href}: {type(exc).__name__}")
                    if len(jobs) >= MAX_JOBS:
                        break
            except Exception as exc:
                warnings.append(f"Careers page {careers_url} unavailable: {type(exc).__name__}")
            if len(jobs) >= MAX_JOBS:
                break

    unique = []
    seen = set()
    for job in jobs:
        if job.get("url") and job["url"] not in seen:
            seen.add(job["url"])
            unique.append(job)
    return unique[:MAX_JOBS], warnings
