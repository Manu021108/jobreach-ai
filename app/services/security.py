import base64
import hashlib
import hmac
import json
import secrets
import time

from app.config import settings

SECRET_KEY = settings.auth_secret_key or secrets.token_urlsafe(48)
SESSION_MAX_AGE = settings.auth_session_days * 24 * 60 * 60
OAUTH_STATE_MAX_AGE = 10 * 60


def hash_password(password):
    salt = secrets.token_bytes(16)
    iterations = 210_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        algorithm, iterations, salt_hex, digest_hex = str(stored).split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations),
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def new_token():
    return secrets.token_urlsafe(32)


def hash_token(token):
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign_payload(payload):
    body = _encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _encode(hmac.new(SECRET_KEY.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{signature}"


def _read_signed(token):
    try:
        body, signature = str(token or "").split(".", 1)
        expected = _encode(hmac.new(SECRET_KEY.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_decode(body))
        if int(payload["exp"]) < int(time.time()):
            return None
        return int(payload["uid"])
    except Exception:
        return None


def make_session(user_id):
    return _sign_payload({"uid": int(user_id), "exp": int(time.time()) + SESSION_MAX_AGE})


def read_session(token):
    return _read_signed(token)


def make_oauth_state(user_id):
    payload = {
        "uid": int(user_id),
        "exp": int(time.time()) + OAUTH_STATE_MAX_AGE,
        "nonce": secrets.token_hex(8),
    }
    return _sign_payload(payload)


def read_oauth_state(token):
    return _read_signed(token)
