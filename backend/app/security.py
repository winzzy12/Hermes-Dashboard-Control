"""Auth: PBKDF2 password hashing + HS256 JWT in an HttpOnly cookie.

Pattern proven on this box (vps-dashboard): stdlib PBKDF2 + PyJWT, per-install
signing key in backend/.secret (chmod 600). Token carries token_version so
logout-all can invalidate older sessions.
"""
import hashlib
import hmac
import os
import secrets
import threading
import time
from typing import Any, Optional

import jwt
from fastapi import Depends, HTTPException, Request, Response

from . import config, db

_PBKDF2_ROUNDS = 240_000
_lock = threading.Lock()


def _secret() -> bytes:
    if config.SECRET_FILE.exists():
        return config.SECRET_FILE.read_bytes().strip()
    with _lock:
        if config.SECRET_FILE.exists():
            return config.SECRET_FILE.read_bytes().strip()
        key = secrets.token_hex(32).encode()
        config.SECRET_FILE.write_bytes(key)
        config.SECRET_FILE.chmod(0o600)
        return key


# ------------------------------------------------------------- passwords

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, dk_hex = stored.split("$", 2)
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), _PBKDF2_ROUNDS)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------- tokens

def make_token(user_id: int, username: str, token_version: int) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "username": username,
        "ver": token_version,
        "iat": now,
        "exp": now + config.TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def decode_token(token: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        config.COOKIE_NAME,
        token,
        max_age=config.TOKEN_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,  # loopback http; set True behind TLS
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(config.COOKIE_NAME, path="/")


# ------------------------------------------------------------- request auth

def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(config.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get_user_by_id(int(payload["sub"]))
    if user is None or user["token_version"] != payload.get("ver"):
        raise HTTPException(status_code=401, detail="Session invalidated")
    return {"id": user["id"], "username": user["username"], "display_name": user["display_name"],
            "default_model": user["default_model"]}


def require_user(user: dict = Depends(current_user)) -> dict:
    return user


# ------------------------------------------------------------- login rate limiting

_attempts: dict[str, list[float]] = {}
_attempts_lock = threading.Lock()
_WINDOW = 300.0
_MAX_ATTEMPTS = 10


def check_rate_limit(key: str) -> None:
    now = time.time()
    with _attempts_lock:
        stamps = [t for t in _attempts.get(key, []) if now - t < _WINDOW]
        if len(stamps) >= _MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Too many login attempts, try again later")
        _attempts[key] = stamps


def record_attempt(key: str, success: bool) -> None:
    with _attempts_lock:
        stamps = _attempts.setdefault(key, [])
        stamps.append(time.time())
        if success:
            _attempts[key] = [t for t in stamps if time.time() - t < _WINDOW][: _MAX_ATTEMPTS - 1]
