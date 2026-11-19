import re

from sqlalchemy import create_engine, inspect
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateTable
from app.config import settings
from app.db.models import Base

connect_args = {"check_same_thread": False, "timeout": 30} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def _ensure_columns():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required = {
        "contacts": {
            "website": "ALTER TABLE contacts ADD COLUMN website VARCHAR(500) DEFAULT ''",
            "owner_id": "ALTER TABLE contacts ADD COLUMN owner_id INTEGER",
        },
        "email_drafts": {
            "job_id": "ALTER TABLE email_drafts ADD COLUMN job_id INTEGER",
            "owner_id": "ALTER TABLE email_drafts ADD COLUMN owner_id INTEGER",
        },
        "job_postings": {
            "owner_id": "ALTER TABLE job_postings ADD COLUMN owner_id INTEGER",
            "posted_at": "ALTER TABLE job_postings ADD COLUMN posted_at DATETIME",
            "salary_min": "ALTER TABLE job_postings ADD COLUMN salary_min INTEGER",
            "salary_max": "ALTER TABLE job_postings ADD COLUMN salary_max INTEGER",
            "salary_currency": "ALTER TABLE job_postings ADD COLUMN salary_currency VARCHAR(10) DEFAULT ''",
            "salary_period": "ALTER TABLE job_postings ADD COLUMN salary_period VARCHAR(20) DEFAULT ''",
            "experience_level": "ALTER TABLE job_postings ADD COLUMN experience_level VARCHAR(30) DEFAULT ''",
            "employment_type": "ALTER TABLE job_postings ADD COLUMN employment_type VARCHAR(50) DEFAULT ''",
            "remote": "ALTER TABLE job_postings ADD COLUMN remote BOOLEAN DEFAULT 0",
            "fingerprint": "ALTER TABLE job_postings ADD COLUMN fingerprint VARCHAR(64)",
            "first_seen_at": "ALTER TABLE job_postings ADD COLUMN first_seen_at DATETIME",
            "last_seen_at": "ALTER TABLE job_postings ADD COLUMN last_seen_at DATETIME",
        },
        "outreach_events": {
            "owner_id": "ALTER TABLE outreach_events ADD COLUMN owner_id INTEGER",
            "followup_draft_id": "ALTER TABLE outreach_events ADD COLUMN followup_draft_id INTEGER",
        },
        "campaigns": {
            "last_error": "ALTER TABLE campaigns ADD COLUMN last_error TEXT DEFAULT ''",
            "started_at": "ALTER TABLE campaigns ADD COLUMN started_at DATETIME",
            "paused_at": "ALTER TABLE campaigns ADD COLUMN paused_at DATETIME",
        },
        "campaign_contacts": {
            "last_attempt_at": "ALTER TABLE campaign_contacts ADD COLUMN last_attempt_at DATETIME",
            "reserved_at": "ALTER TABLE campaign_contacts ADD COLUMN reserved_at DATETIME",
        },
        "users": {
            "onboarding_completed": "ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN DEFAULT 1",
            "dry_run": "ALTER TABLE users ADD COLUMN dry_run BOOLEAN",
        },
    }
    for table, columns in required.items():
        if table not in tables:
            continue
        existing = {column["name"] for column in inspector.get_columns(table)}
        for name, statement in columns.items():
            if name not in existing:
                with engine.begin() as connection:
                    connection.exec_driver_sql(statement)


def _index_columns(connection, name):
    quoted = name.replace('"', '""')
    rows = connection.exec_driver_sql(f'PRAGMA index_info("{quoted}")').fetchall()
    return [row[2] for row in rows]


def _migrate_contact_uniqueness():
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as connection:
        indexes = connection.exec_driver_sql("PRAGMA index_list('contacts')").fetchall()
        old_index = None
        plain_indexes = []
        for row in indexes:
            name, unique = row[1], row[2]
            origin = row[3] if len(row) > 3 else ""
            columns = _index_columns(connection, name)
            if unique and set(columns) == {"email", "company_name"}:
                old_index = name
            elif not unique and origin == "c":
                plain_indexes.append((name, columns))
        if not old_index:
            return

        table = Base.metadata.tables["contacts"]
        create_sql = str(CreateTable(table).compile(dialect=sqlite.dialect())).strip()
        create_sql = re.sub(r"^CREATE TABLE contacts\b", "CREATE TABLE contacts_new", create_sql, count=1)
        names = [column.name for column in table.columns]
        column_list = ", ".join(f'"{name}"' for name in names)
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        try:
            connection.exec_driver_sql(create_sql)
            connection.exec_driver_sql(
                f"INSERT INTO contacts_new ({column_list}) SELECT {column_list} FROM contacts"
            )
            connection.exec_driver_sql("DROP TABLE contacts")
            connection.exec_driver_sql("ALTER TABLE contacts_new RENAME TO contacts")
            for name, columns in plain_indexes:
                quoted_name = name.replace('"', '""')
                quoted_columns = ", ".join(f'"{column}"' for column in columns)
                connection.exec_driver_sql(
                    f'CREATE INDEX "{quoted_name}" ON contacts ({quoted_columns})'
                )
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def _migrate_job_contact_nullable():
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as connection:
        columns = connection.exec_driver_sql("PRAGMA table_info('job_postings')").fetchall()
        contact_column = next((row for row in columns if row[1] == "contact_id"), None)
        if not contact_column or not contact_column[3]:
            return

        indexes = connection.exec_driver_sql("PRAGMA index_list('job_postings')").fetchall()
        plain_indexes = []
        for row in indexes:
            name, unique = row[1], row[2]
            origin = row[3] if len(row) > 3 else ""
            if not unique and origin == "c":
                plain_indexes.append((name, _index_columns(connection, name)))

        table = Base.metadata.tables["job_postings"]
        create_sql = str(CreateTable(table).compile(dialect=sqlite.dialect())).strip()
        create_sql = re.sub(r"^CREATE TABLE job_postings\b", "CREATE TABLE job_postings_new", create_sql, count=1)
        names = [column.name for column in table.columns]
        column_list = ", ".join(f'"{name}"' for name in names)
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        try:
            connection.exec_driver_sql(create_sql)
            connection.exec_driver_sql(
                f"INSERT INTO job_postings_new ({column_list}) SELECT {column_list} FROM job_postings"
            )
            connection.exec_driver_sql("DROP TABLE job_postings")
            connection.exec_driver_sql("ALTER TABLE job_postings_new RENAME TO job_postings")
            for name, columns in plain_indexes:
                quoted_name = name.replace('"', '""')
                quoted_columns = ", ".join(f'"{column}"' for column in columns)
                connection.exec_driver_sql(
                    f'CREATE INDEX "{quoted_name}" ON job_postings ({quoted_columns})'
                )
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    _migrate_contact_uniqueness()
    _migrate_job_contact_nullable()
    if settings.database_url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_job_postings_fingerprint ON job_postings (fingerprint)")
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
