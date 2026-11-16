import json
from openai import OpenAI
from app.config import settings

SYSTEM_PROMPT = """You write concise, professional, truthful job inquiry emails. Return ONLY valid JSON with keys subject and body. Never invent company facts, job vacancies, personal relationships, recruiter names, metrics, qualifications, or experience. Use only the supplied sender profile and contact context. If company_context is blank, personalize only using the company name and role; do not pretend to have researched the company. Do not claim an application was submitted. Do not include deceptive urgency or manipulative language. Keep body around 120-170 words, natural and respectful. Ask to be considered for relevant current or future openings. Mention that a resume is attached."""

class AIWriter:
    def __init__(self):
        self.client = OpenAI(base_url=settings.ai_base_url, api_key=settings.ai_api_key)

    def generate(self, contact, resume_filename="resume.pdf") -> dict:
        profile = {
            "name": settings.sender_name,
            "location": settings.sender_location,
            "summary": settings.profile_summary,
            "skills": settings.skills,
            "target_roles": settings.target_roles,
            "phone": settings.sender_phone,
            "linkedin": settings.sender_linkedin,
            "github": settings.sender_github,
        }
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
        return {"subject": subject[:500], "body": body}
