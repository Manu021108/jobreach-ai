from email_validator import validate_email, EmailNotValidError


def test_valid_email():
    assert validate_email("person@example.com", check_deliverability=False).normalized == "person@example.com"


def test_invalid_email_rejected():
    try:
        validate_email("not-an-email", check_deliverability=False)
        assert False, "Expected invalid email to fail"
    except EmailNotValidError:
        assert True
