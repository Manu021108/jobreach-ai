import base64
import mimetypes
from email.message import EmailMessage
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from app.config import settings

class GmailService:
    def __init__(self):
        self.token_path = settings.path(settings.gmail_token_file)
        self.client_secret_path = settings.path(settings.gmail_client_secret_file)
        self.service = None

    def connect(self):
        creds = None
        self.token_path.parent.mkdir(parents=True, exist_ok=True)
        if self.token_path.exists():
            creds = Credentials.from_authorized_user_file(str(self.token_path), settings.scopes)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not self.client_secret_path.exists():
                    raise FileNotFoundError(f"OAuth client JSON not found: {self.client_secret_path}")
                flow = InstalledAppFlow.from_client_secrets_file(str(self.client_secret_path), settings.scopes)
                creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
            self.token_path.write_text(creds.to_json(), encoding="utf-8")
        self.service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        return self

    def send(self, recipient: str, subject: str, body: str, attachment: Path):
        if not self.service:
            self.connect()
        if not attachment.exists() or attachment.suffix.lower() != ".pdf":
            raise FileNotFoundError("A valid PDF resume must be selected before sending")
        message = EmailMessage()
        message["To"] = recipient
        message["Subject"] = subject
        if settings.sender_name:
            message["From"] = f'{settings.sender_name} <{settings.sender_email}>'
        message.set_content(body)
        mime_type, _ = mimetypes.guess_type(str(attachment))
        maintype, subtype = (mime_type or "application/pdf").split("/", 1)
        message.add_attachment(attachment.read_bytes(), maintype=maintype, subtype=subtype, filename=attachment.name)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
        try:
            return self.service.users().messages().send(userId="me", body={"raw": raw}).execute()
        except HttpError:
            raise

    def list_recent_inbox(self, max_results=100):
        if not self.service:
            self.connect()
        return self.service.users().messages().list(userId="me", q="in:inbox newer_than:90d", maxResults=max_results).execute().get("messages", [])

    def get_message(self, message_id):
        if not self.service:
            self.connect()
        return self.service.users().messages().get(userId="me", id=message_id, format="metadata", metadataHeaders=["From", "To", "Subject", "Date"]).execute()
