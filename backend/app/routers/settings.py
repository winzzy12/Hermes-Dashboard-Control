"""Settings: user profile + preferences (stored in the dashboard's own DB)."""
from fastapi import APIRouter, Depends

from .. import db, security

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings(user: dict = Depends(security.require_user)):
    row = db.get_user_by_id(user["id"])
    return {
        "username": row["username"],
        "display_name": row["display_name"],
        "default_model": row["default_model"],
        "created_at": row["created_at"],
    }


@router.patch("")
def update_settings(body: dict, user: dict = Depends(security.require_user)):
    display_name = body.get("display_name")
    if display_name is not None:
        db.update_user(user["id"], display_name=str(display_name).strip()[:60])
    default_model = body.get("default_model")
    if default_model is not None:
        db.update_user(user["id"], default_model=str(default_model).strip()[:120])
    row = db.get_user_by_id(user["id"])
    return {"username": row["username"], "display_name": row["display_name"],
            "default_model": row["default_model"]}
