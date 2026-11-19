from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

ROOT = Path(__file__).resolve().parents[1]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore")
    app_name: str = "JobReach AI"
    database_url: str = "postgresql://jobreach:jobreach@localhost:5432/jobreach"
    timezone: str = "Asia/Kolkata"
    sender_name: str = "Your Full Name"
    sender_email: str = "you@gmail.com"
    sender_phone: str = ""
    sender_linkedin: str = ""
    sender_github: str = ""
    sender_location: str = "Hyderabad, India"
    profile_summary: str = "Python Developer and AI/ML Engineer with full-stack web development experience, website building, and basic React Native knowledge"
    skills: str = "Python, Machine Learning, Deep Learning, Full-Stack Development, Website Development, React, React Native (basic)"
    target_roles: str = "Python Developer, AI/ML Engineer"
    ai_provider: str = "ollama"
    ai_model: str = "qwen2.5:7b"
    ai_base_url: str = "http://localhost:11434/v1"
    ai_api_key: str = "ollama"
    ai_temperature: float = Field(default=0.4, ge=0, le=1)
    gmail_client_secret_file: str = "credentials/client_secret.json"
    gmail_scopes: str = "https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly"
    gmail_oauth_redirect_uri: str = "http://127.0.0.1:8000/api/gmail/oauth/callback"
    gmail_token_encryption_key: str = ""
    celery_broker_url: str = "redis://127.0.0.1:6379/0"
    celery_result_backend: str = "redis://127.0.0.1:6379/1"
    celery_task_always_eager: bool = False
    celery_task_time_limit: int = Field(default=900, ge=60, le=86400)
    dry_run: bool = True
    max_emails_per_run: int = Field(default=5, ge=1, le=25)
    min_seconds_between_emails: int = Field(default=45, ge=10, le=3600)
    max_emails_per_day: int = Field(default=20, ge=1, le=100)
    auto_send_worker_enabled: bool = True
    auto_send_poll_seconds: int = Field(default=5, ge=1, le=60)
    auto_send_max_attempts: int = Field(default=3, ge=1, le=10)
    auto_send_retry_backoff_seconds: int = Field(default=300, ge=10, le=3600)
    auto_send_send_lease_seconds: int = Field(default=900, ge=60, le=3600)
    followup_default_days: int = Field(default=7, ge=2, le=30)
    followup_auto_draft_enabled: bool = True
    followup_poll_seconds: int = Field(default=60, ge=10, le=3600)
    followup_max_per_run: int = Field(default=5, ge=1, le=25)
    auth_secret_key: str = ""
    auth_session_days: int = Field(default=7, ge=1, le=30)
    auth_cookie_secure: bool = False
    verification_token_hours: int = Field(default=24, ge=1, le=168)
    reset_token_hours: int = Field(default=1, ge=1, le=24)
    auth_dev_tokens: bool = True
    frontend_url: str = "http://127.0.0.1:8000"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""
    stripe_unlock_amount: int = Field(default=29900, ge=50)
    stripe_unlock_currency: str = "inr"
    allow_free_unlock: bool = True
    hr_database_file: str = "data/hr_database.csv"
    job_discovery_enabled: bool = True
    job_discovery_poll_seconds: int = Field(default=900, ge=60, le=86400)
    job_discovery_portals: str = "remotive,arbeitnow,remoteok"
    job_discovery_max_per_source: int = Field(default=25, ge=1, le=100)
    job_discovery_max_companies: int = Field(default=20, ge=1, le=100)
    job_discovery_timeout_seconds: int = Field(default=8, ge=2, le=30)
    job_alert_email_enabled: bool = False

    @property
    def root(self) -> Path:
        return ROOT

    @property
    def scopes(self) -> list[str]:
        return [s.strip() for s in self.gmail_scopes.split(",") if s.strip()]

    def path(self, value: str) -> Path:
        p = Path(value)
        return p if p.is_absolute() else ROOT / p

settings = Settings()
