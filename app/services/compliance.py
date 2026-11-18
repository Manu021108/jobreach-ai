from urllib.parse import quote

from app.config import settings
from app.services import security


def dry_run_enabled(user):
    value = getattr(user, "dry_run", None) if user is not None else None
    return settings.dry_run if value is None else bool(value)


def unsubscribe_url(contact, owner_id=None):
    owner = owner_id if owner_id is not None else getattr(contact, "owner_id", None)
    token = security.make_unsubscribe_token(contact.id, owner)
    return f"{settings.frontend_url.rstrip('/')}/api/unsubscribe?token={quote(token)}"


def with_opt_out(body, contact, owner_id=None):
    url = unsubscribe_url(contact, owner_id)
    footer = (
        "\n\n--\n"
        "You are receiving this email because your address was listed as a relevant "
        "professional contact. If you do not want to receive further emails, "
        f"unsubscribe here: {url}\n"
    )
    return f"{str(body or '').rstrip()}{footer}"
