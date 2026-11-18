import json
import re
from openai import OpenAI
from app.config import settings

SYSTEM_PROMPT = """You write concise, professional, truthful job inquiry emails. Return ONLY valid JSON with keys subject and body. Never invent company facts, job vacancies, personal relationships, recruiter names, metrics, qualifications, or experience. Use only the supplied sender profile and contact context, and draw from the listed skills when describing qualifications. If company_context is blank, personalize only using the company name and role; do not pretend to have researched the company. Never include placeholders, bracketed instructions, or template text such as '[mention a specific area if known]'. If a detail is not in the supplied context, omit it entirely instead of leaving a blank for the sender to fill. Do not claim an application was submitted. Do not include deceptive urgency or manipulative language. Keep body around 120-170 words, natural and respectful. Ask to be considered for relevant current or future openings. Mention that a resume is attached."""

JOB_SYSTEM_PROMPT = """You write concise, truthful inquiry emails about a VERIFIED job listing. Return ONLY valid JSON with keys subject and body. Use only facts present in 'verified_job' and 'sender_profile', and draw from the sender's listed skills when describing qualifications. You MUST name the exact job title and include the official job URL exactly as supplied. Never invent responsibilities, requirements, salary, company facts, personal relationships, application status, or experience. Never include placeholders, bracketed instructions, or template text such as '[mention a specific area if known]'. If a detail is not in the supplied context, omit it entirely instead of leaving a blank for the sender to fill. Do not claim an application was submitted. Do not include deceptive urgency. Keep body around 120-170 words, natural and respectful. Ask to be considered for this specific verified opening and mention that a resume is attached. If active is false, do not present the role as currently open."""

_PLACEHOLDER = re.compile(r"\[[^\]]*\]|\bif known\b|\botherwise:\b|\bmention a specific\b", re.I)


def _strip_placeholders(text):
    sentences = re.split(r"(?<=[.!?])\s+", str(text or ""))
    kept = [part.strip() for part in sentences if part.strip() and not _PLACEHOLDER.search(part)]
    return re.sub(r"\s+", " ", " ".join(kept)).strip()


class AIWriter:
    def __init__(self, profile=None):
        self.client = OpenAI(base_url=settings.ai_base_url, api_key=settings.ai_api_key)
        self.profile = profile

    def _profile(self):
        if self.profile:
            return self.profile
        return {
            "name": settings.sender_name,
            "location": settings.sender_location,
            "summary": settings.profile_summary,
            "skills": settings.skills,
            "target_roles": settings.target_roles,
            "phone": settings.sender_phone,
            "linkedin": settings.sender_linkedin,
            "github": settings.sender_github,
        }

    def generate(self, contact, resume_filename="resume.pdf") -> dict:
        profile = self._profile()
        target = {
            "company_name": contact.company_name,
            "recipient_name": contact.hr_name or "Hiring Team",
            "target_role": contact.role or "Relevant Opportunities",
            "verified_company_context_supplied_by_user": contact.company_context or "",
            "job_url_supplied_by_user": contact.job_url or "",
            "sender_profile": profile,
            "resume_filename": resume_filename,
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
        subject = str(data.get("subject", "")).strip()
        body = str(data.get("body", "")).strip()
        if not subject or not body:
            raise ValueError("AI did not return a valid subject and body")
        subject = _strip_placeholders(subject)[:500]
        body = _strip_placeholders(body)
        if not subject or not body:
            raise ValueError("AI returned only placeholder text")
        return {"subject": subject, "body": body}

    def generate_for_job(self, contact, job, match=None, resume_filename="resume.pdf") -> dict:
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
            "recipient_name": contact.hr_name or "Hiring Team",
            "recipient_email": contact.email,
            "verified_job": verified_job,
            "sender_profile": self._profile(),
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
        subject = str(data.get("subject", "")).strip()
        body = str(data.get("body", "")).strip()
        if not subject or not body:
            raise ValueError("AI did not return a valid subject and body")
        subject = _strip_placeholders(subject)[:500]
        body = _strip_placeholders(body)
        if not subject or not body:
            raise ValueError("AI returned only placeholder text")
        return {"subject": subject, "body": body}
