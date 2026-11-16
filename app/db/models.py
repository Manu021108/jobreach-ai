from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow():
    return datetime.now(timezone.utc)

class Base(DeclarativeBase):
    pass

class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("email", "company_name", name="uq_contact_email_company"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    hr_name: Mapped[str] = mapped_column(String(200), default="Hiring Team")
    role: Mapped[str] = mapped_column(String(200), default="Relevant Opportunities")
    company_context: Mapped[str] = mapped_column(Text, default="")
    job_url: Mapped[str] = mapped_column(String(1000), default="")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    opted_out: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    drafts: Mapped[list["EmailDraft"]] = relationship(back_populates="contact", cascade="all, delete-orphan")
    events: Mapped[list["OutreachEvent"]] = relationship(back_populates="contact", cascade="all, delete-orphan")

class EmailDraft(Base):
    __tablename__ = "email_drafts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    contact: Mapped[Contact] = relationship(back_populates="drafts")

class OutreachEvent(Base):
    __tablename__ = "outreach_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"), nullable=False, index=True)
    draft_id: Mapped[int | None] = mapped_column(ForeignKey("email_drafts.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    message_id: Mapped[str] = mapped_column(String(300), default="")
    thread_id: Mapped[str] = mapped_column(String(300), default="")
    details: Mapped[str] = mapped_column(Text, default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    followup_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    contact: Mapped[Contact] = relationship(back_populates="events")
