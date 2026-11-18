import re
from urllib.parse import urlparse

FREE_MAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com",
    "outlook.com", "live.com", "rediffmail.com", "icloud.com", "proton.me",
    "protonmail.com", "aol.com", "mail.com", "example.com",
}


def normalize_website(value):
    text = str(value or "").strip()
    if not text:
        return ""
    if not re.match(r"^https?://", text, re.IGNORECASE):
        text = "https://" + text
    return text[:500]


def website_from_email(email, existing=""):
    if existing:
        return normalize_website(existing)
    domain = str(email or "").split("@")[-1].strip().lower()
    if not domain or domain in FREE_MAIL_DOMAINS or "." not in domain:
        return ""
    return normalize_website(domain)


def company_slug(value):
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return text[:60]


def domain_label(website):
    host = urlparse(normalize_website(website)).netloc.lower()
    return host.split(":")[0].split(".")[0] if host else ""
