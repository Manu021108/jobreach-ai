import json
import re
from openai import OpenAI
from app.config import settings

EMAIL_STRUCTURE = """

Rewrite the supplied structured_draft into a polished, natural email. Keep the exact same structure and facts:
- One greeting line using recipient_name.
- One opening paragraph.
- The exact line "A few reasons I may be a good fit:".
- Exactly three plain "- " bullet lines.
- One closing paragraph.
- "Best regards," and the sender's name only.

Do not add, remove, or invent experience, metrics, vacancies, company facts, relationships, or application status. Use only values from structured_draft and sender_profile. Never include placeholders, bracketed instructions, or template text such as '[mention a specific area if known]'. If a detail is not in the supplied context, omit it entirely. Do not claim an application was submitted. Do not include deceptive urgency. Keep the body 120-180 words, plain text, with blank lines between sections and no markdown, headings, labels, or commentary. The subject must be 4-8 words and include the role or company."""

SYSTEM_PROMPT = """You are an email editor. Return ONLY valid JSON with keys subject and body.""" + EMAIL_STRUCTURE

JOB_SYSTEM_PROMPT = """You are an email editor for a VERIFIED job listing. Return ONLY valid JSON with keys subject and body. Use only facts present in 'verified_job', 'structured_draft', and 'sender_profile'. The email must name the exact job title and include the official job URL exactly as supplied. If active is false, do not present the role as currently open.""" + EMAIL_STRUCTURE

MODE_GUIDANCE = {
    "application": "Write a focused application email for a specific role. Emphasize the most relevant supplied skills and ask to be considered.",
    "general": "Write a concise general job inquiry. Ask about relevant current or future openings without claiming a specific vacancy.",
    "recruiter": "Write a brief recruiter introduction. Lead with the candidate profile and target roles, then invite a conversation.",
    "hr": "Write a professional HR outreach note. Be respectful, concise, and focused on fit for relevant roles.",
    "followup": "Write a polite follow-up on an earlier message. Do not repeat the full introduction or imply a reply was received.",
    "referral": "Write a referral-oriented note. Ask for guidance or consideration without claiming an existing relationship or referral.",
}

_PLACEHOLDER = re.compile(r"\[[^\]]*\]|\bif known\b|\botherwise:\b|\bmention a specific\b", re.I)


def _clean_line(line):
    sentences = re.split(r"(?<=[.!?])\s+", line.strip())
    kept = [part.strip() for part in sentences if part.strip() and not _PLACEHOLDER.search(part)]
    return " ".join(kept).strip()


def _strip_placeholders(text):
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cleaned = []
    for line in lines:
        if not line.strip():
            if cleaned and cleaned[-1]:
                cleaned.append("")
            continue
        value = _clean_line(line)
        if value:
            cleaned.append(value)
    while cleaned and not cleaned[0]:
        cleaned.pop(0)
    while cleaned and not cleaned[-1]:
        cleaned.pop()
    return "\n".join(cleaned)


_SIGNOFF = re.compile(r"(?im)^\s*(?:best regards|kind regards|regards|sincerely|thanks|thank you)[,]?\s*$")


def _is_contact_line(line, profile):
    value = str(line or "").strip()
    if not value:
        return True
    lowered = value.lower()
    if "@" in value or lowered.startswith(("http://", "https://", "www.")):
        return True
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 7 and len(value) <= 32:
        return True
    for key in ("phone", "email", "linkedin", "github"):
        expected = str(profile.get(key) or "").strip().lower()
        if expected and lowered == expected:
            return True
    return False


def _finalize_body(body, profile):
    text = str(body or "").strip()
    signoff = None
    for match in _SIGNOFF.finditer(text):
        signoff = match
    if signoff:
        text = text[:signoff.start()].rstrip()
    lines = text.split("\n")
    name = str(profile.get("name") or "").strip()
    while lines:
        last = lines[-1].strip()
        if not last or (name and last.lower() == name.lower()) or _is_contact_line(last, profile):
            lines.pop()
            continue
        break
    body_text = "\n".join(lines).rstrip()
    signature = ["Best regards,"]
    if name:
        signature.append(name)
    for key in ("phone", "email", "linkedin", "github"):
        value = str(profile.get(key) or "").strip()
        if value:
            signature.append(value)
    return body_text + ("\n\n" if body_text else "") + "\n".join(signature)


def _split_items(value):
    items = []
    for part in re.split(r"[,;\n]", str(value or "")):
        item = part.strip(" .")
        if item and item.lower() not in {existing.lower() for existing in items}:
            items.append(item)
    return items


def _first_name(recipient):
    value = str(recipient or "").strip()
    if not value or "team" in value.lower() or "hiring" in value.lower():
        return "Hiring Team"
    return value.split()[0]


def _fit_bullets(profile):
    templates = (
        "I have hands-on experience with {}.",
        "I am comfortable working with {}.",
        "My background includes {}.",
    )
    bullets = [
        templates[index % len(templates)].format(skill)
        for index, skill in enumerate(_split_items(profile.get("skills")))
    ]
    for role in _split_items(profile.get("target_roles")):
        if len(bullets) >= 3:
            break
        bullets.append(f"I am focused on {role} roles.")
    summary = re.sub(r"\s+", " ", str(profile.get("summary") or "")).strip().rstrip(".")
    if len(summary) > 160:
        summary = summary[:157].rstrip() + "..."
    if len(bullets) < 3 and summary:
        bullets.append(f"My background includes {summary}.")
    while len(bullets) < 3:
        bullets.append("I am ready to contribute and learn quickly.")
    return bullets[:3]


def _structured_draft(contact, profile, mode="general", job=None):
    name = str(profile.get("name") or "the candidate").strip()
    location = str(profile.get("location") or "").strip()
    role = str((job.title if job else contact.role) or "Relevant Opportunities").strip()
    company = str((job.company_name if job and job.company_name else contact.company_name) or "your company").strip()
    recipient = _first_name(contact.hr_name)
    based = f" based in {location}" if location else ""
    if mode == "followup":
        opening = f"I am following up on my earlier note about {role} opportunities at {company}."
    elif job:
        opening = f"I am {name}, a {role}{based}. I am reaching out about the {job.title} role at {company}."
    else:
        opening = f"I am {name}, a {role}{based}. I am reaching out about {role} opportunities at {company}."
    closing = "I have attached my resume and would welcome a brief conversation about how I can contribute."
    if job and getattr(job, "url", ""):
        closing = f"I have attached my resume and would welcome a brief conversation. The official listing is available here: {job.url}."
    body = (
        f"Hi {recipient},\n\n{opening}\n\n"
        "A few reasons I may be a good fit:\n"
        + "\n".join(f"- {bullet}" for bullet in _fit_bullets(profile))
        + f"\n\n{closing}\n\nBest regards,\n{name}"
    )
    return {"subject": f"{role} at {company}", "body": body}


def _has_structure(body):
    text = str(body or "").replace("\r\n", "\n").strip()
    lines = [line.strip() for line in text.split("\n")]
    fit_index = next((index for index, line in enumerate(lines) if line.lower() == "a few reasons i may be a good fit:"), None)
    if fit_index is None:
        return False
    greeting_index = next((index for index, line in enumerate(lines) if line), None)
    if greeting_index is None or not lines[greeting_index].lower().startswith(("hi ", "dear ")):
        return False
    if not any(line for line in lines[greeting_index + 1:fit_index]):
        return False
    bullets = [line for line in lines[fit_index + 1:] if line.startswith("- ")]
    if len(bullets) < 3:
        return False
    signoff_index = next((index for index, line in enumerate(lines) if line.lower().startswith("best regards")), None)
    if signoff_index is None:
        return False
    bullet_end = max(index for index, line in enumerate(lines) if line.startswith("- "))
    if not any(line for line in lines[bullet_end + 1:signoff_index]):
        return False
    return True


class AIWriter:
    def __init__(self, profile=None):
        self.client = OpenAI(base_url=settings.ai_base_url, api_key=settings.ai_api_key)
        self.profile = profile

    def _profile(self):
        if self.profile:
            return self.profile
        return {
            "name": settings.sender_name,
            "email": settings.sender_email,
            "location": settings.sender_location,
            "summary": settings.profile_summary,
            "skills": settings.skills,
            "target_roles": settings.target_roles,
            "phone": settings.sender_phone,
            "linkedin": settings.sender_linkedin,
            "github": settings.sender_github,
        }

    def generate(self, contact, resume_filename="resume.pdf", mode="general") -> dict:
        profile = self._profile()
        mode = mode if mode in MODE_GUIDANCE else "general"
        draft = _structured_draft(contact, profile, mode)
        target = {
            "structured_draft": draft,
            "company_name": contact.company_name,
            "recipient_name": contact.hr_name or "Hiring Team",
            "target_role": contact.role or "Relevant Opportunities",
            "verified_company_context_supplied_by_user": contact.company_context or "",
            "job_url_supplied_by_user": contact.job_url or "",
            "sender_profile": profile,
            "resume_filename": resume_filename,
            "requested_mode": mode,
            "mode_guidance": MODE_GUIDANCE[mode],
        }
        response = self.client.chat.completions.create(
            model=settings.ai_model,
            temperature=settings.ai_temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(target, ensure_ascii=False)},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        subject = _strip_placeholders(str(data.get("subject", "")).strip())[:500] or draft["subject"]
        body = _strip_placeholders(str(data.get("body", "")).strip())
        if not _has_structure(body):
            body = draft["body"]
        return {"subject": subject, "body": _finalize_body(body, profile)}

    def generate_for_job(self, contact, job, match=None, resume_filename="resume.pdf") -> dict:
        profile = self._profile()
        draft = _structured_draft(contact, profile, "application", job=job)
        verified_job = {
            "company": job.company_name or contact.company_name,
            "title": job.title,
            "location": job.location or "",
            "official_url": job.url,
            "source": job.source,
            "source_url": job.source_url or job.url,
            "active": bool(job.active),
            "description_excerpt": str(job.description or "")[:1500],
            "skill_match": match or {},
        }
        target = {
            "structured_draft": draft,
            "recipient_name": contact.hr_name or "Hiring Team",
            "recipient_email": contact.email,
            "verified_job": verified_job,
            "sender_profile": profile,
            "resume_filename": resume_filename,
        }
        response = self.client.chat.completions.create(
            model=settings.ai_model,
            temperature=settings.ai_temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": JOB_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(target, ensure_ascii=False)},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        subject = _strip_placeholders(str(data.get("subject", "")).strip())[:500] or draft["subject"]
        body = _strip_placeholders(str(data.get("body", "")).strip())
        if not _has_structure(body):
            body = draft["body"]
        return {"subject": subject, "body": _finalize_body(body, profile)}
