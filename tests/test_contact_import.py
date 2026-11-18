from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, Contact
from app.services import audit, outreach


def test_import_skips_duplicate_rows_in_the_same_file(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    monkeypatch.setattr(outreach, "SessionLocal", test_session)
    monkeypatch.setattr(audit, "SessionLocal", test_session)

    added, skipped, errors = outreach.add_contacts([
        {"company_name": "Acme", "email": " PERSON@example.com "},
        {"company_name": "Acme", "email": "person@example.com"},
        {"company_name": "", "email": "other@example.com"},
    ])

    with test_session() as db:
        contacts = list(db.scalars(select(Contact)).all())
    engine.dispose()

    assert added == 1
    assert skipped == 2
    assert len(errors) == 1
    assert len(contacts) == 1
    assert contacts[0].email == "person@example.com"
