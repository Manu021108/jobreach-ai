from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

ROOT = Path(__file__).resolve().parents[1]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore")
    app_name: str = "JobReach AI"
    database_url: str = f"sqlite:///{ROOT / 'data' / 'jobreach.db'}"
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
    gmail_token_file: str = "credentials/token.json"
    gmail_scopes: str = "https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly"
    dry_run: bool = True
    max_emails_per_run: int = Field(default=5, ge=1, le=25)
    min_seconds_between_emails: int = Field(default=45, ge=10, le=3600)
    max_emails_per_day: int = Field(default=20, ge=1, le=100)
    followup_default_days: int = Field(default=7, ge=2, le=30)

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
