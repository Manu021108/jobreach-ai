import io
import re
from dataclasses import dataclass
from typing import Optional

import pdfplumber


COMMON_SKILLS = {
    "python", "javascript", "typescript", "java", "c++", "c#", "go", "rust", "ruby",
    "php", "swift", "kotlin", "scala", "r", "matlab", "sql", "nosql", "mongodb",
    "postgresql", "mysql", "redis", "elasticsearch", "docker", "kubernetes",
    "aws", "gcp", "azure", "terraform", "ansible", "jenkins", "git", "github",
    "gitlab", "ci/cd", "linux", "bash", "powershell", "html", "css", "react",
    "vue", "angular", "svelte", "nextjs", "nuxt", "django", "flask", "fastapi",
    "spring", "express", "nodejs", "deno", "bun", "graphql", "rest", "grpc",
    "machine learning", "deep learning", "nlp", "computer vision", "tensorflow",
    "pytorch", "scikit-learn", "keras", "huggingface", "langchain", "llm",
    "data engineering", "etl", "airflow", "spark", "kafka", "snowflake",
    "bigquery", "redshift", "databricks", "tableau", "power bi", "looker",
    "agile", "scrum", "kanban", "jira", "confluence", "notion", "figma",
    "adobe", "photoshop", "illustrator", "ui/ux", "design systems",
    "testing", "pytest", "jest", "cypress", "playwright", "selenium",
    "microservices", "api design", "system design", "distributed systems",
    "blockchain", "web3", "solidity", "smart contracts", "defi",
    "mobile", "ios", "android", "react native", "flutter", "xamarin",
    "devops", "sre", "observability", "prometheus", "grafana", "datadog",
    "security", "penetration testing", "owasp", "cryptography", "auth",
    "oauth", "jwt", "sso", "iam", "compliance", "gdpr", "hipaa", "soc2",
}

EXPERIENCE_KEYWORDS = [
    r"(\d+\+?\s*years?\s*(?:of\s*)?experience)",
    r"(?:experience|worked|work)\s*(?:of|:)?\s*(\d+\+?\s*years?)",
    r"(\d+\+?\s*years?\s*(?:in|with)\s+\w+)",
    r"(senior|lead|principal|staff|junior|entry.level|mid.level)\s*(?:engineer|developer|scientist|analyst)",
]

EDUCATION_KEYWORDS = [
    r"(bachelor|master|phd|doctorate|b\.?s\.?|m\.?s\.?|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?)",
    r"(computer science|software engineering|data science|machine learning|artificial intelligence|information technology|electrical engineering)",
    r"(university|institute|college|school)",
]

DATE_PATTERNS = [
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}",
    r"\d{1,2}/\d{4}",
    r"\d{4}[-/]\d{2}",
    r"(20\d{2})\s*[-–—]\s*(?:present|current|20\d{2})",
    r"(20\d{2})",
]


@dataclass
class ParsedResume:
    skills: list[str]
    experience_years: Optional[int]
    experience_level: Optional[str]
    education: list[str]
    summary: str
    raw_text: str


def extract_text_from_pdf(content: bytes) -> str:
    """Extract all text from a PDF file."""
    text_parts = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
    return "\n".join(text_parts)


def extract_skills(text: str) -> list[str]:
    """Extract skills from resume text using keyword matching."""
    text_lower = text.lower()
    found_skills = set()

    for skill in COMMON_SKILLS:
        pattern = r"\b" + re.escape(skill) + r"\b"
        if re.search(pattern, text_lower):
            found_skills.add(skill.title() if " " not in skill else skill.upper() if skill.isupper() else skill)

    # Also look for skills in common resume sections
    skills_section_pattern = r"(skills|technologies|tech stack|competencies|expertise)[:\n](.*?)(?:\n\n|\n[A-Z]|\Z)"
    for match in re.finditer(skills_section_pattern, text_lower, re.IGNORECASE | re.DOTALL):
        section_text = match.group(2)
        for skill in COMMON_SKILLS:
            pattern = r"\b" + re.escape(skill) + r"\b"
            if re.search(pattern, section_text.lower()):
                found_skills.add(skill.title() if " " not in skill else skill.upper() if skill.isupper() else skill)

    return sorted(found_skills)[:50]  # Limit to 50 skills


def extract_experience(text: str) -> tuple[Optional[int], Optional[str]]:
    """Extract years of experience and level from resume text."""
    text_lower = text.lower()

    # Look for explicit years of experience
    years_patterns = [
        r"(\d+)\+?\s*years?\s*(?:of\s*)?(?:experience|exp)",
        r"(?:experience|exp)\s*(?:of|:)?\s*(\d+)\+?\s*years?",
        r"(\d+)\+?\s*years?\s*(?:in|with)\s+\w+",
    ]

    max_years = None
    for pattern in years_patterns:
        matches = re.findall(pattern, text_lower)
        for match in matches:
            try:
                years = int(match)
                if max_years is None or years > max_years:
                    max_years = years
            except ValueError:
                continue

    # Determine experience level
    level = None
    if max_years is not None:
        if max_years >= 8:
            level = "SENIOR"
        elif max_years >= 5:
            level = "MID"
        elif max_years >= 2:
            level = "ENTRY"
        else:
            level = "FRESHER"
    else:
        # Fallback: check for senior/junior keywords
        if re.search(r"\b(senior|lead|principal|staff)\b", text_lower):
            level = "SENIOR"
        elif re.search(r"\b(mid.level|mid.level)\b", text_lower):
            level = "MID"
        elif re.search(r"\b(junior|entry.level|fresher|new.grad)\b", text_lower):
            level = "FRESHER"

    return max_years, level


def extract_education(text: str) -> list[str]:
    """Extract education information from resume text."""
    education = []
    text_lower = text.lower()

    # Look for degree patterns
    degree_patterns = [
        r"(phd|doctorate|ph\.d\.)",
        r"(master|m\.?s\.?|m\.?tech|m\.?e\.?|mba)",
        r"(bachelor|b\.?s\.?|b\.?tech|b\.?e\.?|b\.?a\.?)",
        r"(associate|diploma|certificate)",
    ]

    for pattern in degree_patterns:
        matches = re.findall(pattern, text_lower)
        for match in matches:
            degree = match.upper() if len(match) <= 4 else match.title()
            if degree not in education:
                education.append(degree)

    # Look for field of study
    field_patterns = [
        r"(computer science|software engineering|data science|machine learning|artificial intelligence|information technology|electrical engineering|computer engineering)",
    ]

    for pattern in field_patterns:
        matches = re.findall(pattern, text_lower)
        for match in matches:
            field = match.title()
            if field not in education:
                education.append(field)

    # Look for university/college names (capitalized words near education keywords)
    uni_pattern = r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:university|institute|college|school)"
    matches = re.findall(uni_pattern, text)
    for match in matches:
        if match not in education:
            education.append(match)

    return education[:10]


def extract_summary(text: str) -> str:
    """Extract or generate a professional summary from resume text."""
    # Look for summary/objective/profile sections
    summary_patterns = [
        r"(?:summary|objective|profile|about me|professional summary)[:\n](.*?)(?:\n\n|\n[A-Z][A-Z]|\nEXPERIENCE|\nEDUCATION|\nSKILLS|\Z)",
        r"(?:summary|objective|profile)[:\n](.*?)(?:\n\n|\n[A-Z]|\Z)",
    ]

    for pattern in summary_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            summary = match.group(1).strip()
            summary = re.sub(r"\s+", " ", summary)
            if len(summary) > 50:
                return summary[:500]

    # Fallback: use first substantial paragraph
    paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 80]
    if paragraphs:
        return paragraphs[0][:500]

    return ""


def parse_resume(content: bytes) -> ParsedResume:
    """Parse a PDF resume and extract structured information."""
    raw_text = extract_text_from_pdf(content)

    skills = extract_skills(raw_text)
    experience_years, experience_level = extract_experience(raw_text)
    education = extract_education(raw_text)
    summary = extract_summary(raw_text)

    return ParsedResume(
        skills=skills,
        experience_years=experience_years,
        experience_level=experience_level,
        education=education,
        summary=summary,
        raw_text=raw_text,
    )


def merge_parsed_into_profile(parsed: ParsedResume, existing_profile: dict) -> dict:
    """Merge parsed resume data into existing profile, preferring existing values."""
    merged = existing_profile.copy()

    # Skills: merge and deduplicate
    existing_skills = set(s.strip().lower() for s in merged.get("skills", "").split(",") if s.strip())
    parsed_skills = set(s.lower() for s in parsed.skills)
    merged_skills = existing_skills | parsed_skills
    merged["skills"] = ", ".join(sorted(merged_skills, key=str.lower))

    # Summary: use existing if present, otherwise parsed
    if not merged.get("summary") and parsed.summary:
        merged["summary"] = parsed.summary

    # Target roles: infer from experience level if not set
    if not merged.get("target_roles") and parsed.experience_level:
        level_roles = {
            "FRESHER": "Junior Developer, Entry Level Engineer",
            "ENTRY": "Software Engineer, Developer",
            "MID": "Software Engineer, Senior Developer",
            "SENIOR": "Senior Software Engineer, Tech Lead, Staff Engineer",
        }
        merged["target_roles"] = level_roles.get(parsed.experience_level, "")

    # Location: could be extracted from contact info, but skip for now

    return merged