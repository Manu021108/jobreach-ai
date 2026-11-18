import re

from app.config import settings

SKILL_GROUPS = {
    "Python": [r"\bpython\b", r"\bfastapi\b", r"\bdjango\b", r"\bflask\b"],
    "AI/ML": [
        r"machine learning", r"deep learning", r"artificial intelligence",
        r"\bml\b", r"\bai\b", r"tensorflow", r"pytorch", r"scikit", r"\bnlp\b",
    ],
    "Data Engineering": [
        r"data engineer", r"\betl\b", r"\bairflow\b", r"\bspark\b", r"\bkafka\b",
        r"data pipeline", r"data warehouse", r"\bsql\b", r"snowflake", r"bigquery",
    ],
    "Full-Stack/Web": [
        r"full[ -]?stack", r"web developer", r"web development", r"website",
        r"front[ -]?end", r"back[ -]?end", r"\breact\b", r"react native",
        r"\bjavascript\b", r"\btypescript\b", r"\bhtml\b", r"\bcss\b",
        r"\bdjango\b", r"\bfastapi\b", r"\bstreamlit\b",
    ],
}


def _configured_skills(profile=None):
    source = profile.get("skills", "") if profile else settings.skills
    return [item.strip() for item in str(source).split(",") if item.strip()]


def _mentions(text, keywords):
    return any(re.search(pattern, text) for pattern in keywords)


def match_job(job, profile=None):
    title = str(job.title or "").lower()
    description = str(job.description or "")[:12000].lower()
    text = f"{title} {description}"
    configured = _configured_skills(profile)

    matched = set()
    reasons = []
    for group, keywords in SKILL_GROUPS.items():
        if _mentions(text, keywords):
            matched.add(group)
            if _mentions(title, keywords):
                reasons.append(f"Job title mentions {group}")
            else:
                reasons.append(f"Description mentions {group}")
        else:
            reasons.append(f"No clear evidence of {group} in this listing")

    for skill in configured:
        tokens = [token for token in re.findall(r"[a-z0-9+#]+", skill.lower()) if len(token) >= 3]
        if tokens and any(token in text for token in tokens):
            matched.add(skill)

    labels = list(dict.fromkeys(list(SKILL_GROUPS) + configured))
    missing = [label for label in labels if label not in matched]
    score = round(100 * len(matched) / len(labels)) if labels else 0
    target_roles = profile.get("target_roles", "") if profile else settings.target_roles
    if any(role.strip().lower() in title for role in str(target_roles).split(",") if role.strip()):
        reasons.insert(0, "Job title matches your target roles")
        score = min(100, score + 5)
    return {
        "score": score,
        "matched": sorted(matched),
        "missing": missing[:6],
        "reasons": reasons[:6],
    }
