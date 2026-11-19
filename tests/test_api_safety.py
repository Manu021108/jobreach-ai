from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from main import _send_block_reason, settings


def build_draft(status="APPROVED", contact_status="DRAFTED", opted_out=False):
    return SimpleNamespace(
        status=status,
        contact=SimpleNamespace(
            status=contact_status,
            opted_out=opted_out,
            email="person@example.com",
        ),
    )


def test_send_is_blocked_in_dry_run(monkeypatch):
    monkeypatch.setattr("main.settings.dry_run", True)
    confirmation = SimpleNamespace(reviewed=True, typed_recipient="person@example.com")

    reason = _send_block_reason(build_draft(), confirmation, 0, 0, None, datetime.now(timezone.utc))

    assert reason == "Dry-run is enabled. Sending is disabled."


def test_send_requires_exact_recipient_confirmation(monkeypatch):
    monkeypatch.setattr("main.settings.dry_run", False)
    confirmation = SimpleNamespace(reviewed=True, typed_recipient="PERSON@example.com")

    reason = _send_block_reason(build_draft(), confirmation, 0, 0, None, datetime.now(timezone.utc))

    assert reason == "Review the email and type the exact recipient address to confirm."


def test_send_is_blocked_for_opted_out_or_already_contacted(monkeypatch):
    monkeypatch.setattr("main.settings.dry_run", False)
    confirmation = SimpleNamespace(reviewed=True, typed_recipient="person@example.com")

    for status, opted_out in [("OPTED_OUT", False), ("SENT", False), ("DRAFTED", True)]:
        reason = _send_block_reason(
            build_draft(contact_status=status, opted_out=opted_out),
            confirmation, 0, 0, None, datetime.now(timezone.utc),
        )
        assert reason == "This contact is no longer eligible for outreach."


def test_followup_draft_can_be_sent_after_original_send(monkeypatch):
    monkeypatch.setattr("main.settings.dry_run", False)
    confirmation = SimpleNamespace(reviewed=True, typed_recipient="person@example.com")

    reason = _send_block_reason(
        build_draft(contact_status="SENT"), confirmation, 0, 0, None,
        datetime.now(timezone.utc), is_followup=True,
    )

    assert reason is None


def test_send_enforces_interval_and_caps(monkeypatch):
    monkeypatch.setattr("main.settings.dry_run", False)
    confirmation = SimpleNamespace(reviewed=True, typed_recipient="person@example.com")
    now = datetime.now(timezone.utc)
    recent_send = now - timedelta(seconds=1)

    reason = _send_block_reason(build_draft(), confirmation, 0, 0, recent_send, now)

    assert reason == f"Wait at least {settings.min_seconds_between_emails} seconds between sends."

    daily_cap = settings.max_emails_per_day
    reason = _send_block_reason(build_draft(), confirmation, daily_cap, 0, None, now)
    assert reason == "Daily sending cap reached."

    run_cap = settings.max_emails_per_run
    reason = _send_block_reason(build_draft(), confirmation, 0, run_cap, None, now)
    assert reason.startswith("Per-run sending cap reached.")


def test_send_is_allowed_after_all_safety_checks(monkeypatch):
    monkeypatch.setattr("main.settings.dry_run", False)
    confirmation = SimpleNamespace(reviewed=True, typed_recipient="person@example.com")

    reason = _send_block_reason(
        build_draft(), confirmation, 0, 0, None, datetime.now(timezone.utc),
    )

    assert reason is None
