from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.db.models import Base

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def _ensure_columns():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required = {
        "contacts": {"website": "ALTER TABLE contacts ADD COLUMN website VARCHAR(500) DEFAULT ''"},
        "email_drafts": {"job_id": "ALTER TABLE email_drafts ADD COLUMN job_id INTEGER"},
    }
    for table, columns in required.items():
        if table not in tables:
            continue
        existing = {column["name"] for column in inspector.get_columns(table)}
        for name, statement in columns.items():
            if name not in existing:
                with engine.begin() as connection:
                    connection.exec_driver_sql(statement)


def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    if settings.database_url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
