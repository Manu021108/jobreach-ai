import base64
import mimetypes
from email.message import EmailMessage
from pathlib import Path

from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.config import settings
from app.services.gmail_tokens import GmailAuthError


def build_oauth_flow():
    client_secret_path = settings.path(settings.gmail_client_secret_file)
    if not client_secret_path.exists():
        raise FileNotFoundError(f"OAuth client JSON not found: {client_secret_path}")
    return Flow.from_client_secrets_file(
        str(client_secret_path),
        scopes=settings.scopes,
        redirect_uri=settings.gmail_oauth_redirect_uri,
    )


def authorization_url(state):
    url, _ = build_oauth_flow().authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
        state=state,
    )
    return url


def complete_oauth(code):
    flow = build_oauth_flow()
    flow.fetch_token(code=code)
    credentials = flow.credentials
    service = build("gmail", "v1", credentials=credentials, cache_discovery=False)
    try:
        profile = service.users().getProfile(userId="me").execute()
    except HttpError as exc:
        raise GmailAuthError("Gmail account details could not be read after authorization.") from exc
    return credentials, profile.get("emailAddress", "")


class GmailService:
    def __init__(self, owner_id):
        if owner_id is None:
            raise ValueError("A user is required to connect Gmail")
        self.owner_id = int(owner_id)
        self.service = None
        self.email = None

    def connect(self):
        from app.services import gmail_tokens

        credentials, email, _expires_at = gmail_tokens.load_credentials(self.owner_id)
        self.email = email
        self.service = build("gmail", "v1", credentials=credentials, cache_discovery=False)
        return self

    def send(self, recipient: str, subject: str, body: str, attachment: Path, sender_name: str | None = None):
        if not self.service:
            self.connect()
        if not attachment.exists() or attachment.suffix.lower() != ".pdf":
            raise FileNotFoundError("A valid PDF resume must be selected before sending")
        message = EmailMessage()
        message["To"] = recipient
        message["Subject"] = subject
        if self.email:
            display_name = sender_name if sender_name is not None else settings.sender_name
            message["From"] = f"{display_name} <{self.email}>" if display_name else self.email
        message.set_content(body)
        mime_type, _ = mimetypes.guess_type(str(attachment))
        maintype, subtype = (mime_type or "application/pdf").split("/", 1)
        message.add_attachment(
            attachment.read_bytes(), maintype=maintype, subtype=subtype, filename=attachment.name
        )
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
        return self.service.users().messages().send(userId="me", body={"raw": raw}).execute()

    def list_recent_inbox(self, max_results=100):
        if not self.service:
            self.connect()
        return (
            self.service.users()
            .messages()
            .list(userId="me", q="in:inbox newer_than:90d", maxResults=max_results)
            .execute()
            .get("messages", [])
        )

    def get_message(self, message_id):
        if not self.service:
            self.connect()
        return (
            self.service.users()
            .messages()
            .get(
                userId="me",
                id=message_id,
                format="metadata",
                metadataHeaders=["From", "To", "Subject", "Date"],
            )
            .execute()
        )
