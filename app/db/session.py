import re

from sqlalchemy import create_engine, inspect
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateTable
from app.config import settings
from app.db.models import Base

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
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
        "job_postings": {"owner_id": "ALTER TABLE job_postings ADD COLUMN owner_id INTEGER"},
        "outreach_events": {"owner_id": "ALTER TABLE outreach_events ADD COLUMN owner_id INTEGER"},
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


def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    _migrate_contact_uniqueness()
    if settings.database_url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
