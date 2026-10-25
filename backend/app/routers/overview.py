"""Overview + recents (merged activity feed from real stores)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import config, db, security
from ..hermes import cron as cronmod
from ..hermes import health, models as hermes_models, skills as hermes_skills, store

router = APIRouter(prefix="/api", tags=["overview"])


@router.get("/overview")
def overview(user: dict = Depends(security.require_user)):
    # Conversations/messages from the dashboard's own store
    conv_count = db.one("SELECT COUNT(*) AS c FROM conversations")["c"]
    msg_count = db.one("SELECT COUNT(*) AS c FROM messages")["c"]
    metrics = store.overview_metrics()
    skills = hermes_skills.list_skills()
    try:
        jobs = cronmod.list_jobs(include_disabled=True)
        cron_error = ""
    except Exception as e:  # noqa: BLE001
        jobs, cron_error = [], str(e)[:200]
    try:
        mc = hermes_models.model_config()
    except Exception as e:  # noqa: BLE001
        mc, _ = {"default_model": "", "provider": "", "base_url": "", "has_api_key": False}, None
    recent_sessions = store.list_sessions(limit=6)
    try:
        execs = cronmod.job_executions(limit=6)
    except Exception:  # noqa: BLE001
        execs = []
    return {
        "mode": config.MODE,
        "conversations": conv_count,
        "dashboard_messages": msg_count,
        "agent_sessions": metrics.get("total", 0),
        "agent_tokens": {"input": metrics.get("input_tokens", 0),
                         "output": metrics.get("output_tokens", 0)},
        "agent_sessions_unavailable": bool(metrics.get("unavailable")),
        "skills": {"total": len(skills),
                   "enabled": sum(1 for s in skills if s["status"] == "enabled")},
        "cronjobs": {"total": len(jobs),
                     "active": sum(1 for j in jobs if j["status"] in ("active", "enabled", ""))},
        "cron_error": cron_error,
        "model": mc,
        "recent_sessions": recent_sessions,
        "recent_executions": execs,
        "last_health": _last_health_summary(),
    }


def _last_health_summary() -> dict:
    rows = db.q(
        "SELECT name, status, ts FROM health_checks h WHERE id = ("
        " SELECT MAX(id) FROM health_checks h2 WHERE h2.name = h.name)")
    return {r["name"]: {"status": r["status"], "ts": r["ts"]} for r in rows}


@router.get("/recents")
def recents(type: str = Query("", alias="type"), search: str = "",
            status: str = "", limit: int = Query(50, ge=1, le=200), offset: int = 0,
            user: dict = Depends(security.require_user)):
    items: list[dict] = []
    if type in ("", "session"):
        for s in store.list_sessions(limit=limit, offset=0, search=search):
            if s.get("title"):
                items.append({
                    "kind": "session", "id": s["id"], "title": s["title"],
                    "source": s.get("source", ""), "model": s.get("model", ""),
                    "status": "done" if s.get("ended_at") else "active",
                    "ts": s.get("last_activity_at") or s.get("started_at"),
                    "message_count": s.get("message_count"),
                    "input_tokens": s.get("input_tokens"), "output_tokens": s.get("output_tokens"),
                })
    if type in ("", "chat"):
        rows = db.q(
            "SELECT c.id, c.title, c.updated_at, COUNT(m.id) AS n FROM conversations c "
            "JOIN messages m ON m.conversation_id = c.id "
            "WHERE c.title LIKE ? GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?",
            (f"%{search}%", limit))
        for r in rows:
            items.append({"kind": "chat", "id": r["id"], "title": r["title"],
                          "status": "done", "ts": r["updated_at"], "message_count": r["n"]})
    if type in ("", "cron"):
        for e in cronmod.job_executions(limit=limit):
            if search and search.lower() not in (e.get("job_id") or "").lower():
                continue
            if status and e.get("status") != status:
                continue
            items.append({"kind": "cron", "id": e["id"], "job_id": e.get("job_id"),
                          "title": f"cron: {e.get('job_id', '?')[:18]}",
                          "status": e.get("status"), "ts": e.get("started_at"),
                          "error": e.get("error")})
    items.sort(key=lambda x: x.get("ts") or 0, reverse=True)
    return {"items": items[offset:offset + limit], "total_estimate": len(items)}


@router.get("/recents/session/{session_id}")
def session_detail(session_id: str, user: dict = Depends(security.require_user)):
    try:
        msgs = store.session_messages(session_id)
    except Exception:  # noqa: BLE001
        msgs = []
    if not msgs:
        raise HTTPException(status_code=404, detail="Session not found or has no messages")
    return {"id": session_id, "messages": msgs}
