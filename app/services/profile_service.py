from sqlalchemy import select

from app.config import settings
from app.db.models import Resume, StudentProfile, User
from app.db.session import SessionLocal
from app.services.resume_parser import ParsedResume, parse_resume, merge_parsed_into_profile


FIELDS = {
    "full_name": 200,
    "phone": 50,
    "location": 200,
    "linkedin": 500,
    "github": 500,
    "summary": 20_000,
    "skills": 5_000,
    "target_roles": 500,
}
REQUIRED = ("full_name", "summary", "skills", "target_roles")


def get_profile(user_id):
    with SessionLocal() as db:
        return db.scalar(select(StudentProfile).where(StudentProfile.user_id == int(user_id)))


def save_profile(user_id, values):
    with SessionLocal() as db:
        user = db.get(User, int(user_id))
        if not user:
            raise ValueError("User not found")
        row = db.scalar(select(StudentProfile).where(StudentProfile.user_id == int(user_id)))
        if not row:
            row = StudentProfile(user_id=int(user_id))
            db.add(row)
        for field, limit in FIELDS.items():
            setattr(row, field, str(values.get(field) or "")[:limit])
        user.name = row.full_name or user.name
        db.commit()
        db.refresh(row)
        return row


def get_resume(user_id):
    with SessionLocal() as db:
        return db.scalar(select(Resume).where(Resume.user_id == int(user_id)))


def save_resume(user_id, filename, content):
    with SessionLocal() as db:
        row = db.scalar(select(Resume).where(Resume.user_id == int(user_id)))
        if not row:
            row = Resume(user_id=int(user_id))
            db.add(row)
        row.filename = str(filename)[:300]
        row.content = content
        row.size = len(content)
        db.commit()
        db.refresh(row)
    # Parse resume and merge into profile
    try:
        parsed = parse_resume(content)
        existing = profile_dict(user_id) or {}
        merged = merge_parsed_into_profile(parsed, existing)
        save_profile(user_id, merged)
    except Exception:
        # Silently fail - parsing is best-effort
        pass
    return row


def delete_resume(user_id):
    with SessionLocal() as db:
        row = db.scalar(select(Resume).where(Resume.user_id == int(user_id)))
        if row:
            db.delete(row)
            db.commit()


def _profile_values(user_id):
    with SessionLocal() as db:
        user = db.get(User, int(user_id))
        if not user:
            return None, None, None
        profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == int(user_id)))
        resume = db.scalar(select(Resume).where(Resume.user_id == int(user_id)))
        return user, profile, resume


def profile_dict(user_id):
    user, profile, resume = _profile_values(user_id)
    if not user:
        return None
    return {
        "full_name": profile.full_name if profile else user.name,
        "email": user.email,
        "phone": profile.phone if profile else "",
        "location": profile.location if profile else "",
        "linkedin": profile.linkedin if profile else "",
        "github": profile.github if profile else "",
        "summary": profile.summary if profile else "",
        "skills": profile.skills if profile else "",
        "target_roles": profile.target_roles if profile else "",
        "resume_name": resume.filename if resume else None,
    }


def ai_profile(user_id):
    data = profile_dict(user_id) or {}
    return {
        "name": data.get("full_name", ""),
        "email": data.get("email", ""),
        "location": data.get("location", ""),
        "summary": data.get("summary", ""),
        "skills": data.get("skills", ""),
        "target_roles": data.get("target_roles", ""),
        "phone": data.get("phone", ""),
        "linkedin": data.get("linkedin", ""),
        "github": data.get("github", ""),
    }


def onboarding_status(user_id):
    with SessionLocal() as db:
        user = db.get(User, int(user_id))
        if not user:
            return {"completed": False, "profile_complete": False, "resume_uploaded": False}
        profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == int(user_id)))
        resume = db.scalar(select(Resume).where(Resume.user_id == int(user_id)))
        profile_complete = bool(profile and all(getattr(profile, field, "") for field in REQUIRED))
        return {
            "completed": bool(user.onboarding_completed),
            "profile_complete": profile_complete,
            "resume_uploaded": bool(resume),
        }


def complete_onboarding(user_id):
    status = onboarding_status(user_id)
    if not status["profile_complete"]:
        raise ValueError("Complete your student profile first.")
    if not status["resume_uploaded"]:
        raise ValueError("Upload your resume first.")
    with SessionLocal() as db:
        user = db.get(User, int(user_id))
        user.onboarding_completed = True
        db.commit()
        db.refresh(user)
        return user


def claim_legacy_resume(user_id):
    if get_resume(user_id):
        return
    candidates = sorted(settings.path("resumes").glob("*.pdf"))
    if not candidates:
        return
    source = candidates[0]
    save_resume(user_id, source.name, source.read_bytes())
