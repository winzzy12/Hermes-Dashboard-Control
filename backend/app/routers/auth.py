"""Auth endpoints: first-run setup, login, logout, me, password change."""
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import db, security

router = APIRouter(prefix="/api/auth", tags=["auth"])

UNAME = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")


@router.get("/status")
def auth_status():
    """Frontend uses this to decide between first-run setup and login."""
    return {"users_exist": db.users_count() > 0}


@router.post("/setup")
def setup(body: dict, response: Response):
    if db.users_count() > 0:
        raise HTTPException(status_code=409, detail="Admin already exists")
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not UNAME.match(username):
        raise HTTPException(status_code=422, detail="Username: 3-32 chars, letters/digits/._-")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    uid = db.create_user(username, security.hash_password(password), username)
    token = security.make_token(uid, username, 1)
    security.set_session_cookie(response, token)
    return {"ok": True, "username": username}


@router.post("/login")
def login(body: dict, request: Request, response: Response):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    key = request.client.host if request.client else "unknown"
    security.check_rate_limit(key)
    user = db.get_user(username)
    ok = user is not None and security.verify_password(password, user["password_hash"])
    security.record_attempt(key, ok)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = security.make_token(user["id"], user["username"], user["token_version"])
    security.set_session_cookie(response, token)
    return {"ok": True, "username": user["username"]}


@router.post("/logout")
def logout(response: Response):
    security.clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(security.require_user)):
    return user


@router.post("/password")
def change_password(body: dict, user: dict = Depends(security.require_user)):
    current = body.get("current_password") or ""
    new = body.get("new_password") or ""
    if len(new) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    row = db.get_user_by_id(user["id"])
    if not security.verify_password(current, row["password_hash"]):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    db.update_user(user["id"], password_hash=security.hash_password(new))
    return {"ok": True}
