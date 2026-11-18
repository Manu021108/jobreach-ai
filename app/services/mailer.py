import smtplib
from email.message import EmailMessage

from app.config import settings


def _send(to, subject, body):
    if not settings.smtp_host:
        return False
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from or settings.smtp_user or "no-reply@jobreach.ai"
    message["To"] = to
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(message)
    return True


def send_verification_email(to, token):
    link = f"{settings.frontend_url.rstrip('/')}/?verify={token}"
    body = (
        "Welcome to JobReach AI.\n\n"
        "Verify your student email to activate your account:\n"
        f"{link}\n\n"
        "If you did not create this account, ignore this message.\n"
    )
    try:
        return _send(to, "Verify your JobReach AI email", body)
    except Exception:
        return False


def send_password_reset_email(to, token):
    link = f"{settings.frontend_url.rstrip('/')}/?reset={token}"
    body = (
        "A password reset was requested for your JobReach AI account.\n\n"
        f"Reset your password: {link}\n\n"
        "The link expires soon. If you did not request it, ignore this message.\n"
    )
    try:
        return _send(to, "Reset your JobReach AI password", body)
    except Exception:
        return False
