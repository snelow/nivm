"""
Project NIVM — Single-User Owner Authentication & Security Manager.

Provides:
- Salted PBKDF2-HMAC-SHA256 password hashing and verification
- Emergency Recovery Key generator and validator (for remote password reset)
- Cryptographic session signing and validation (HMAC-SHA256 + cookie / Bearer token)
- Secure credential management in User files/auth.json
"""

import os
import json
import time
import hmac
import base64
import hashlib
import secrets
import logging
from typing import Optional, Tuple, Dict, Any

from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel

from .config import USER_FILES_DIR

logger = logging.getLogger("nivm.auth")

AUTH_FILE = os.path.join(USER_FILES_DIR, "auth.json")
RECOVERY_KEY_FILE = os.path.join(USER_FILES_DIR, "recovery_key.txt")
SESSION_COOKIE_NAME = "nivm_session"
DEFAULT_SESSION_DAYS = 30
PBKDF2_ITERATIONS = 100_000

router = APIRouter(tags=["Authentication"])


# Cryptographic helpers

def _generate_salt(length: int = 16) -> str:
    """Generate a random cryptographic hex salt."""
    return secrets.token_hex(length)


def _hash_secret(value: str, salt: str) -> str:
    """Hash a secret (password or recovery key) using PBKDF2-HMAC-SHA256."""
    key = hashlib.pbkdf2_hmac(
        "sha256",
        value.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return key.hex()


def _generate_recovery_key() -> str:
    """
    Generate a human-readable 24-character Emergency Recovery Key.
    Format: NIVM-XXXX-XXXX-XXXX-XXXX (Base32 Crockford-safe alphabet)
    """
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    groups = [
        "".join(secrets.choice(alphabet) for _ in range(4))
        for _ in range(4)
    ]
    return f"NIVM-{'-'.join(groups)}"


def _normalize_recovery_key(key: str) -> str:
    """Clean and normalize a recovery key for comparison."""
    return key.strip().upper().replace(" ", "").replace("_", "-")


# Storage and configuration

def is_auth_configured() -> bool:
    """Return True if an owner account exists and is configured."""
    if not os.path.isfile(AUTH_FILE):
        return False
    try:
        with open(AUTH_FILE, "r") as f:
            data = json.load(f)
            return bool(data.get("username") and data.get("password_hash"))
    except Exception:
        return False


def get_auth_data() -> Dict[str, Any]:
    """Read auth.json data."""
    if not os.path.isfile(AUTH_FILE):
        return {}
    try:
        with open(AUTH_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load auth.json: {e}")
        return {}


def save_auth_data(data: Dict[str, Any]):
    """Save auth data to auth.json securely."""
    os.makedirs(USER_FILES_DIR, exist_ok=True)
    with open(AUTH_FILE, "w") as f:
        json.dump(data, f, indent=2)
    try:
        os.chmod(AUTH_FILE, 0o600)
    except Exception:
        pass


def setup_owner_account(username: str, password: str) -> str:
    """
    Initialize or update the owner account.
    Returns the newly generated plaintext Emergency Recovery Key.
    """
    username = username.strip() or "admin"
    pwd_salt = _generate_salt()
    pwd_hash = _hash_secret(password, pwd_salt)

    recovery_key = _generate_recovery_key()
    rec_salt = _generate_salt()
    rec_hash = _hash_secret(recovery_key, rec_salt)

    signing_secret = secrets.token_hex(32)

    auth_data = {
        "username": username,
        "salt": pwd_salt,
        "password_hash": pwd_hash,
        "recovery_salt": rec_salt,
        "recovery_hash": rec_hash,
        "signing_secret": signing_secret,
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
        "sessions": {}
    }
    save_auth_data(auth_data)

    # Also persist recovery key to recovery_key.txt with restricted permissions
    try:
        with open(RECOVERY_KEY_FILE, "w") as f:
            f.write(f"PROJECT NIVM — EMERGENCY RECOVERY KEY\n")
            f.write(f"Generated on: {time.ctime()}\n\n")
            f.write(f"RECOVERY KEY: {recovery_key}\n\n")
            f.write("Save this key in your password manager. It allows you to reset\n")
            f.write("your password remotely from your phone or browser if forgotten.\n")
        os.chmod(RECOVERY_KEY_FILE, 0o600)
    except Exception as e:
        logger.warning(f"Could not write recovery_key.txt: {e}")

    return recovery_key


def verify_owner_password(password: str) -> bool:
    """Verify input password against stored hash."""
    data = get_auth_data()
    salt = data.get("salt")
    expected_hash = data.get("password_hash")
    if not salt or not expected_hash:
        return False
    computed_hash = _hash_secret(password, salt)
    return hmac.compare_digest(computed_hash, expected_hash)


def verify_recovery_key(input_key: str) -> bool:
    """Verify input recovery key against stored hash."""
    data = get_auth_data()
    salt = data.get("recovery_salt")
    expected_hash = data.get("recovery_hash")
    if not salt or not expected_hash:
        return False
    clean_key = _normalize_recovery_key(input_key)
    computed_hash = _hash_secret(clean_key, salt)
    return hmac.compare_digest(computed_hash, expected_hash)


def reset_password_with_recovery(input_key: str, new_password: str) -> Tuple[bool, str]:
    """Reset password using the recovery key."""
    if not verify_recovery_key(input_key):
        return False, "Invalid emergency recovery key"
    if not new_password or len(new_password) < 4:
        return False, "New password must be at least 4 characters"

    data = get_auth_data()
    pwd_salt = _generate_salt()
    pwd_hash = _hash_secret(new_password, pwd_salt)

    # Invalidate all prior sessions on password reset
    data["salt"] = pwd_salt
    data["password_hash"] = pwd_hash
    data["updated_at"] = int(time.time())
    data["sessions"] = {}
    save_auth_data(data)
    return True, "Password reset successfully"


def reset_password_direct(new_password: str) -> bool:
    """Reset password directly from local terminal CLI (bypasses recovery key)."""
    if not new_password or len(new_password) < 4:
        return False
    data = get_auth_data()
    pwd_salt = _generate_salt()
    pwd_hash = _hash_secret(new_password, pwd_salt)
    data["salt"] = pwd_salt
    data["password_hash"] = pwd_hash
    data["updated_at"] = int(time.time())
    data["sessions"] = {}
    save_auth_data(data)
    return True


# Session token management

def create_session_token(username: str, days: int = DEFAULT_SESSION_DAYS) -> str:
    """Create and register a cryptographically secure session token."""
    data = get_auth_data()
    secret = data.get("signing_secret") or secrets.token_hex(32)
    if "signing_secret" not in data:
        data["signing_secret"] = secret

    token_id = secrets.token_urlsafe(32)
    now = int(time.time())
    expires_at = now + (days * 86400)

    # Signature to ensure token tamper resistance
    sig_payload = f"{username}:{token_id}:{expires_at}"
    signature = hmac.new(secret.encode("utf-8"), sig_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    signed_token = f"{token_id}.{signature[:32]}"

    if "sessions" not in data or not isinstance(data["sessions"], dict):
        data["sessions"] = {}

    # Prune expired sessions
    data["sessions"] = {
        k: v for k, v in data["sessions"].items()
        if isinstance(v, dict) and v.get("expires_at", 0) > now
    }

    data["sessions"][signed_token] = {
        "username": username,
        "created_at": now,
        "expires_at": expires_at,
    }
    save_auth_data(data)
    return signed_token


def validate_session(token: str) -> Optional[str]:
    """Validate token and return username if active and unexpired."""
    if not token or not isinstance(token, str):
        return None
    data = get_auth_data()
    sessions = data.get("sessions", {})
    session_info = sessions.get(token)
    if not session_info:
        return None

    now = int(time.time())
    if session_info.get("expires_at", 0) < now:
        # Expired
        return None

    return session_info.get("username", "admin")


def revoke_session(token: str):
    """Revoke a session token."""
    if not token:
        return
    data = get_auth_data()
    sessions = data.get("sessions", {})
    if token in sessions:
        del sessions[token]
        data["sessions"] = sessions
        save_auth_data(data)


def extract_token_from_request(request: Request) -> Optional[str]:
    """Extract session token from Bearer header or HTTP-only cookie."""
    # 1. Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    # 2. Check cookie
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        return cookie_token.strip()

    # 3. Check query param for media embedding if applicable
    query_token = request.query_params.get("token")
    if query_token:
        return query_token.strip()

    return None


# Request and response models

class LoginRequest(BaseModel):
    username: Optional[str] = "admin"
    password: str


class ResetPasswordRequest(BaseModel):
    recovery_key: str
    new_password: str


# API routes

@router.get("/api/auth/status")
async def auth_status_endpoint():
    """Report whether authentication is configured on the host."""
    configured = is_auth_configured()
    data = get_auth_data()
    return {
        "configured": configured,
        "username": data.get("username", "admin") if configured else None,
    }


@router.get("/api/auth/session")
async def auth_session_endpoint(request: Request):
    """Check if the requesting client has a valid active session."""
    if not is_auth_configured():
        return {"authenticated": False, "configured": False}

    token = extract_token_from_request(request)
    username = validate_session(token) if token else None
    return {
        "authenticated": bool(username),
        "username": username,
        "configured": True,
    }


@router.post("/api/auth/login")
async def auth_login_endpoint(req: LoginRequest, response: Response):
    """Authenticate owner and issue session token."""
    if not is_auth_configured():
        raise HTTPException(
            status_code=500,
            detail="Owner account has not been configured. Run ./run.sh --setup on the host machine."
        )

    if not verify_owner_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid password")

    data = get_auth_data()
    username = data.get("username", "admin")
    token = create_session_token(username)

    # Set secure HttpOnly session cookie
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=DEFAULT_SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=False,  # Works seamlessly on LAN HTTP & self-signed HTTPS
        path="/",
    )

    return {
        "status": "authenticated",
        "token": token,
        "username": data.get("username", "admin"),
        "expires_in_days": DEFAULT_SESSION_DAYS,
    }


@router.post("/api/auth/logout")
async def auth_logout_endpoint(request: Request, response: Response):
    """Revoke session and clear session cookie."""
    token = extract_token_from_request(request)
    if token:
        revoke_session(token)

    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.post("/api/auth/reset-password")
async def auth_reset_password_endpoint(req: ResetPasswordRequest, response: Response):
    """Reset password using Emergency Recovery Key and auto-login."""
    if not is_auth_configured():
        raise HTTPException(status_code=400, detail="Auth not configured")

    success, msg = reset_password_with_recovery(req.recovery_key, req.new_password)
    if not success:
        raise HTTPException(status_code=400, detail=msg)

    data = get_auth_data()
    username = data.get("username", "admin")
    token = create_session_token(username)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=DEFAULT_SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )

    return {
        "status": "password_reset_success",
        "token": token,
        "username": username,
    }
