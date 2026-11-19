import re

from sqlalchemy import Boolean, DateTime, Integer, String, Text, create_engine, inspect
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateTable
from app.config import settings
from app.db.models import Base


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    return url


DATABASE_URL = _normalize_database_url(settings.database_url)
is_sqlite = DATABASE_URL.startswith("sqlite")

connect_args = {"check_same_thread": False, "timeout": 30} if is_sqlite else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True, pool_recycle=1800)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _ensure_columns():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required = {
        "contacts": {
            "website": (String(500), "''"),
            "owner_id": (Integer(), None),
        },
        "email_drafts": {
            "job_id": (Integer(), None),
            "owner_id": (Integer(), None),
        },
        "job_postings": {
            "owner_id": (Integer(), None),
            "posted_at": (DateTime(timezone=True), None),
            "salary_min": (Integer(), None),
            "salary_max": (Integer(), None),
            "salary_currency": (String(10), "''"),
            "salary_period": (String(20), "''"),
            "experience_level": (String(30), "''"),
            "employment_type": (String(50), "''"),
            "remote": (Boolean(), "false"),
            "fingerprint": (String(64), None),
            "first_seen_at": (DateTime(timezone=True), None),
            "last_seen_at": (DateTime(timezone=True), None),
        },
        "outreach_events": {
            "owner_id": (Integer(), None),
            "followup_draft_id": (Integer(), None),
        },
        "campaigns": {
            "last_error": (Text(), "''"),
            "started_at": (DateTime(timezone=True), None),
            "paused_at": (DateTime(timezone=True), None),
        },
        "campaign_contacts": {
            "last_attempt_at": (DateTime(timezone=True), None),
            "reserved_at": (DateTime(timezone=True), None),
        },
        "users": {
            "onboarding_completed": (Boolean(), "true"),
            "dry_run": (Boolean(), None),
        },
    }
    for table, columns in required.items():
        if table not in tables:
            continue
        existing = {column["name"] for column in inspector.get_columns(table)}
        for name, (column_type, default) in columns.items():
            if name in existing:
                continue
            type_sql = column_type.compile(dialect=engine.dialect)
            default_sql = f" DEFAULT {default}" if default is not None else ""
            with engine.begin() as connection:
                connection.exec_driver_sql(
                    f'ALTER TABLE {table} ADD COLUMN "{name}" {type_sql}{default_sql}'
                )


def _index_columns(connection, name):
    quoted = name.replace('"', '""')
    rows = connection.exec_driver_sql(f'PRAGMA index_info("{quoted}")').fetchall()
    return [row[2] for row in rows]


def _migrate_contact_uniqueness():
    if not is_sqlite:
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
    if not is_sqlite:
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
    if not is_sqlite:
        return
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    _migrate_contact_uniqueness()
    _migrate_job_contact_nullable()
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_job_postings_fingerprint ON job_postings (fingerprint)")
        conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")
