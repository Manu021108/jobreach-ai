import json
from types import SimpleNamespace

from app.services import ai_writer
from app.services.job_matcher import match_job


class FakeClient:
    def __init__(self, content=None):
        self.calls = []
        self.content = content or json.dumps({"subject": "Subject", "body": "Body"})

    @property
    def chat(self):
        return self

    @property
    def completions(self):
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        message = SimpleNamespace(content=self.content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def test_prompts_forbid_placeholders_and_profile_contains_web_skills(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(ai_writer, "OpenAI", lambda **kwargs: fake)
    contact = SimpleNamespace(
        company_name="Acme", hr_name="Hiring Team", email="hr@acme.com",
        role="Web Developer", company_context="", job_url="",
    )
    job = SimpleNamespace(
        company_name="Acme", title="Web Developer", location="",
        description="Full-stack website development with React and Django.",
        url="https://acme.com/jobs/1", source="careers_page",
        source_url="https://acme.com/careers", active=True,
    )
    writer = ai_writer.AIWriter()
    writer.generate(contact)
    writer.generate_for_job(contact, job)

    assert len(fake.calls) == 2
    for call in fake.calls:
        system = call["messages"][0]["content"].lower()
        assert "placeholder" in system
        assert "omit it entirely" in system
        assert "a few reasons i may be a good fit" in system
        assert "best regards" in system
        profile = json.loads(call["messages"][1]["content"])["sender_profile"]
        assert "Full-Stack Development" in profile["skills"]
        assert "Website Development" in profile["skills"]
        assert "React Native (basic)" in profile["skills"]


def test_matcher_detects_fullstack_web_experience():
    job = SimpleNamespace(
        title="Web Developer",
        description="Full-stack website development with React and Django.",
    )
    assert "Full-Stack/Web" in match_job(job)["matched"]


def test_structured_body_keeps_paragraphs_and_bullets(monkeypatch):
    raw = json.dumps({
        "subject": "Python Developer opportunity at Acme",
        "body": (
            "Hi Asha,\n\n"
            "I am Manish, a Python Developer reaching out about relevant openings at Acme.\n\n"
            "A few reasons I may be a good fit:\n"
            "- I build full-stack web applications with Python and React.\n"
            "- I have hands-on machine learning experience.\n"
            "- I work comfortably across APIs and databases.\n\n"
            "I have attached my resume for review and would welcome a brief conversation.\n\n"
            "Best regards,\nManish\nmanish@example.com"
        ),
    })
    monkeypatch.setattr(ai_writer, "OpenAI", lambda **kwargs: FakeClient(raw))
    contact = SimpleNamespace(
        company_name="Acme", hr_name="Asha", email="hr@acme.com",
        role="Python Developer", company_context="", job_url="",
    )

    profile = {
        "name": "Manish",
        "email": "manish@example.com",
        "phone": "",
        "linkedin": "",
        "github": "",
        "location": "Hyderabad",
        "summary": "Python Developer",
        "skills": "Python, React",
        "target_roles": "Python Developer",
    }
    body = ai_writer.AIWriter(profile).generate(contact)["body"]
    assert body.startswith("Hi Asha,")
    assert "\n\nA few reasons I may be a good fit:\n- " in body
    assert "\n\nBest regards,\nManish\nmanish@example.com" in body
    assert "jordan@example.com" not in body


def test_unstructured_ai_output_falls_back_to_structured_draft(monkeypatch):
    raw = json.dumps({
        "subject": "Python Developer",
        "body": "Hi Asha, I am Manish and I am interested in this role.",
    })
    monkeypatch.setattr(ai_writer, "OpenAI", lambda **kwargs: FakeClient(raw))
    profile = {
        "name": "Manish",
        "email": "manish@example.com",
        "phone": "",
        "linkedin": "",
        "github": "",
        "location": "Hyderabad",
        "summary": "Python Developer",
        "skills": "Python, React, SQL",
        "target_roles": "Python Developer",
    }
    contact = SimpleNamespace(
        company_name="Acme", hr_name="Asha", email="hr@acme.com",
        role="Python Developer", company_context="", job_url="",
    )

    body = ai_writer.AIWriter(profile).generate(contact)["body"]
    assert body.startswith("Hi Asha,")
    assert "A few reasons I may be a good fit:" in body
    assert len([line for line in body.split("\n") if line.startswith("- ")]) == 3
    assert "Best regards,\nManish\nmanish@example.com" in body


def test_placeholder_sentence_is_removed_from_generated_body(monkeypatch):
    raw = json.dumps({
        "subject": "Subject",
        "body": "I am particularly drawn to Volensoftware's work in [mention a specific area if known, otherwise: 'innovative software development']. I have attached my resume for your review.",
    })
    monkeypatch.setattr(ai_writer, "OpenAI", lambda **kwargs: FakeClient(raw))
    contact = SimpleNamespace(
        company_name="Volensoftware", hr_name="Hiring Team", email="hr@volensoftware.com",
        role="Web Developer", company_context="", job_url="",
    )
    generated = ai_writer.AIWriter().generate(contact)
    assert "[" not in generated["body"]
    assert "mention a specific" not in generated["body"]
    assert "I have attached my resume" in generated["body"]
