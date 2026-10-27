"""Staged chat attachments: uploaded files referenced by chat messages.

Flow: the UI uploads files here first (POST /api/chat/attachments), shows chips,
and sends the returned ids with the message. The chat runner embeds text file
contents into the prompt and references image paths for the agent's
vision_analyze tool. Metadata (name/size/is_image/path) is stored as JSON on
the user message row; the staged file itself stays on disk so history and
image thumbnails keep working.
"""
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import config, security

router = APIRouter(prefix="/api/chat", tags=["chat"])

ATTACH_DIR = config.DATA_DIR / "chat_attachments"
MAX_FILES = 5
MAX_FILE_BYTES = 15 * 1024 * 1024
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
# Staged ids are our own "<8 hex>_<sanitized name>" — anything else is rejected
# before it can touch the filesystem (no traversal).
ID_RE = re.compile(r"^[0-9a-f]{8}_[A-Za-z0-9._-]{1,120}$")
_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def attachment_path(aid: str) -> Path:
    if not ID_RE.match(aid):
        raise HTTPException(status_code=422, detail="Invalid attachment id")
    return ATTACH_DIR / aid


def sanitize_name(name: str) -> str:
    base = _NAME_RE.sub("_", Path(name or "").name).strip("._") or "file"
    return base[:80]


def is_image_name(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTS


def prune_old(max_age_s: float = 7 * 24 * 3600) -> None:
    """Best-effort sweep of staged attachments nobody sent within a week."""
    try:
        now = time.time()
        for p in ATTACH_DIR.iterdir():
            try:
                if p.is_file() and now - p.stat().st_mtime > max_age_s:
                    p.unlink()
            except OSError:
                continue
    except OSError:
        pass


@router.post("/attachments")
async def upload_attachments(files: list[UploadFile] = File(...), user: dict = Depends(security.require_user)):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"Max {MAX_FILES} files per message")
    ATTACH_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=422, detail=f"{f.filename}: file too large (max 15 MB)")
        if not data:
            raise HTTPException(status_code=422, detail=f"{f.filename}: empty file")
        aid = f"{uuid.uuid4().hex[:8]}_{sanitize_name(f.filename or 'file')}"
        (ATTACH_DIR / aid).write_bytes(data)
        out.append({"id": aid, "name": f.filename or aid, "size": len(data),
                    "is_image": is_image_name(f.filename or ""), "path": str(ATTACH_DIR / aid)})
    return out


@router.delete("/attachments/{aid}")
def delete_attachment(aid: str, user: dict = Depends(security.require_user)):
    attachment_path(aid).unlink(missing_ok=True)
    return {"ok": True}


@router.get("/attachments/{aid}/raw")
def attachment_raw(aid: str, user: dict = Depends(security.require_user)):
    p = attachment_path(aid)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(p, filename=p.name.split("_", 1)[-1] or p.name)
