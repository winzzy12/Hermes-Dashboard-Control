"""File manager: browse / view / edit / upload / download / delete on the local VPS.

Trust model: the dashboard binds to 127.0.0.1 only and every route requires an
authenticated admin session, so these endpoints operate on the real filesystem.
Safety rails:
- No shell anywhere — pure pathlib/shutil operations.
- Destructive ops (delete, overwrite) require confirm=true.
- A hard-protected list of core system paths can never be deleted.
- Size limits: view 512KB (truncated), edit 2MB, upload 100MB.
- Directory listings are capped to keep huge trees responsive.
"""
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from .. import security

router = APIRouter(prefix="/api/files", tags=["files"])

VIEW_MAX = 512 * 1024
EDIT_MAX = 2 * 1024 * 1024
UPLOAD_MAX = 100 * 1024 * 1024
LIST_CAP = 5000

# These exact paths can never be deleted through the dashboard.
PROTECTED = {
    "/", "/root", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64",
    "/boot", "/var", "/dev", "/proc", "/sys", "/home", "/opt", "/srv", "/lost+found",
}


class FilesError(RuntimeError):
    pass


def _resolve(raw: str) -> Path:
    if not raw or "\x00" in raw or len(raw) > 4096:
        raise HTTPException(status_code=400, detail="invalid path")
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path("/") / p
    return p.resolve()


def _mode_str(mode: int) -> str:
    return format(mode & 0o777, "03o")


def _entry(child: Path) -> dict:
    st = child.lstat()
    is_dir = child.is_dir()
    return {
        "name": child.name,
        "path": str(child),
        "is_dir": is_dir,
        "size": None if is_dir else st.st_size,
        "mtime": st.st_mtime,
        "mode": _mode_str(st.st_mode),
    }


@router.get("")
def list_dir(path: str = "/", user: dict = Depends(security.require_user)):
    p = _resolve(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"not found: {p}")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="not a directory")
    entries: list[dict] = []
    try:
        children = sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower()))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"cannot list: {e}")
    truncated = False
    for child in children:
        if len(entries) >= LIST_CAP:
            truncated = True
            break
        try:
            entries.append(_entry(child))
        except OSError:
            continue
    return {
        "path": str(p),
        "parent": str(p.parent) if str(p) != "/" else None,
        "entries": entries,
        "truncated": truncated,
    }


@router.get("/view")
def view_file(path: str = Query(...), user: dict = Depends(security.require_user)):
    p = _resolve(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="not a file")
    st = p.stat()
    with p.open("rb") as f:
        raw = f.read(VIEW_MAX)
    truncated = st.st_size > len(raw)
    if b"\x00" in raw:
        return {"path": str(p), "name": p.name, "size": st.st_size, "mtime": st.st_mtime,
                "binary": True, "content": None, "truncated": truncated, "encoding": None}
    try:
        text, enc = raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        text, enc = raw.decode("latin-1"), "latin-1"
    return {"path": str(p), "name": p.name, "size": st.st_size, "mtime": st.st_mtime,
            "binary": False, "content": text, "truncated": truncated, "encoding": enc}


@router.put("")
def write_file(body: dict, user: dict = Depends(security.require_user)):
    p = _resolve(body.get("path") or "")
    content = body.get("content")
    if not isinstance(content, str):
        raise HTTPException(status_code=422, detail="content (string) is required")
    if len(content.encode("utf-8")) > EDIT_MAX:
        raise HTTPException(status_code=413, detail=f"content exceeds {EDIT_MAX // 1024}KB limit")
    exists = p.exists()
    if exists and p.is_dir():
        raise HTTPException(status_code=400, detail="target is a directory")
    if exists and not body.get("confirm"):
        raise HTTPException(status_code=400, detail="overwriting an existing file requires confirm=true")
    if not p.parent.exists():
        raise HTTPException(status_code=404, detail="parent directory does not exist")
    try:
        p.write_text(content, encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"write failed: {e}")
    return {"ok": True, "path": str(p), "size": p.stat().st_size, "created": not exists}


@router.post("/upload")
async def upload(path: str = Query(...), file: UploadFile = File(...),
                 overwrite: bool = False, user: dict = Depends(security.require_user)):
    d = _resolve(path)
    if not d.is_dir():
        raise HTTPException(status_code=404, detail="target directory not found")
    name = Path(file.filename or "").name
    if not name or name in (".", ".."):
        raise HTTPException(status_code=422, detail="invalid filename")
    target = d / name
    if target.exists() and not overwrite:
        raise HTTPException(status_code=409, detail=f"{name} already exists (pass overwrite=true to replace)")
    size = 0
    tmp = d / f".upload-{time.time_ns()}-{name}"
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > UPLOAD_MAX:
                    raise HTTPException(status_code=413,
                                        detail=f"file exceeds {UPLOAD_MAX // (1024 * 1024)}MB limit")
                out.write(chunk)
        tmp.replace(target)
    except HTTPException:
        raise
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"upload failed: {e}")
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
    return {"ok": True, "path": str(target), "size": size}


@router.get("/download")
def download(path: str = Query(...), user: dict = Depends(security.require_user)):
    p = _resolve(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="not a file")
    return FileResponse(p, filename=p.name, media_type="application/octet-stream")


@router.delete("")
def delete(path: str = Query(...), confirm: bool = False, user: dict = Depends(security.require_user)):
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass confirm=true to delete")
    p = _resolve(path)
    if str(p) in PROTECTED:
        raise HTTPException(status_code=403, detail=f"deleting {p} is not allowed")
    if not p.exists():
        raise HTTPException(status_code=404, detail="not found")
    try:
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    return {"ok": True, "path": str(p)}
