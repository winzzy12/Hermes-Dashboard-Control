"""Chat: conversations + messages backed by the real hermes CLI."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db, security
from ..hermes import chatrunner, store

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _conv(cid: str):
    row = db.one("SELECT * FROM conversations WHERE id = ?", (cid,))
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return row


@router.get("/conversations")
def list_conversations(search: str = "", user: dict = Depends(security.require_user)):
    rows = db.q(
        "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count "
        "FROM conversations c WHERE c.title LIKE ? ORDER BY c.updated_at DESC LIMIT 100",
        (f"%{search}%",))
    return [dict(r) for r in rows]


@router.post("/conversations")
def create_conversation(body: dict, user: dict = Depends(security.require_user)):
    title = (body.get("title") or "New conversation").strip()[:120] or "New conversation"
    cid = db.new_conversation(title, model=(body.get("model") or "")[:120])
    return {"id": cid, "title": title}


@router.patch("/conversations/{cid}")
def rename_conversation(cid: str, body: dict, user: dict = Depends(security.require_user)):
    _conv(cid)
    title = (body.get("title") or "").strip()[:120]
    if not title:
        raise HTTPException(status_code=422, detail="Title required")
    db.rename_conversation(cid, title)
    return {"ok": True}


@router.delete("/conversations/{cid}")
def delete_conversation(cid: str, user: dict = Depends(security.require_user)):
    _conv(cid)
    db.delete_conversation(cid)
    return {"ok": True}


@router.get("/conversations/{cid}/messages")
def get_messages(cid: str, user: dict = Depends(security.require_user)):
    _conv(cid)
    rows = db.conversation_messages(cid)
    return [dict(r) for r in rows]


@router.post("/conversations/{cid}/messages")
def send_message(cid: str, body: dict, user: dict = Depends(security.require_user)):
    conv = _conv(cid)
    text = (body.get("content") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message content required")
    if len(text) > 32000:
        raise HTTPException(status_code=422, detail="Message too long (max 32000 chars)")
    model = (body.get("model") or "").strip()[:120]
    # Title the conversation from its first user message
    count = db.one("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?", (cid,))["c"]
    if count == 0 and conv["title"] in ("New conversation", ""):
        db.rename_conversation(cid, text[:60] + ("…" if len(text) > 60 else ""))
    hermes_sid = conv["hermes_session_id"] or ""
    if hermes_sid and not store.oneshot_session_alive(hermes_sid):
        hermes_sid = ""  # session pruned on the agent side → start fresh
    db.add_message(cid, "user", text, status="done")
    assistant_id = db.add_message(cid, "assistant", "", status="pending", model=model)
    chatrunner.start_message(assistant_id, cid, text, model, hermes_sid)
    db.touch_conversation(cid)
    return {"message_id": assistant_id}


@router.post("/messages/{msg_id}/stop")
def stop_message(msg_id: int, user: dict = Depends(security.require_user)):
    msg = db.get_message(msg_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="Message not found")
    stopped = chatrunner.stop_message(msg_id)
    if not stopped and msg["status"] in ("pending", "running"):
        db.update_message(msg_id, status="stopped", finished_at=__import__("time").time())
        stopped = True
    return {"ok": stopped}
