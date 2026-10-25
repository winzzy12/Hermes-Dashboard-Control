"""Read-only access to Hermes' canonical stores.

- state.db          sessions + messages (SQLite, WAL — open read-only URIs)
- cron/executions.db  cronjob execution history
Never writes to these databases.
"""
import json
import pathlib
import sqlite3
import time

from .. import config


def _ro(path: pathlib.Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _state() -> sqlite3.Connection:
    return _ro(config.HERMES_HOME / "state.db")


# ------------------------------------------------------------------ sessions

SESSION_COLS = ("id, source, COALESCE(title,'') AS title, COALESCE(model,'') AS model, "
                "started_at, last_activity_at, message_count, input_tokens, output_tokens, "
                "estimated_cost_usd, archived, profile_name")


def list_sessions(limit: int = 50, offset: int = 0, search: str = "",
                  source: str = "") -> list[dict]:
    where = ["hidden = 0"]
    params: list = []
    if search:
        where.append("(title LIKE ? OR last_activity_description LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if source:
        where.append("source = ?")
        params.append(source)
    sql = (f"SELECT {SESSION_COLS} FROM sessions WHERE {' AND '.join(where)} "
           "ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ? OFFSET ?")
    params += [limit, offset]
    with _state() as conn:
        return [dict(r) for r in conn.execute(sql, params)]


def session_stats() -> dict:
    with _state() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total, COALESCE(SUM(input_tokens),0) AS in_tok, "
            "COALESCE(SUM(output_tokens),0) AS out_tok "
            "FROM sessions WHERE hidden = 0").fetchone()
        by_source = {r["source"]: r["c"] for r in conn.execute(
            "SELECT source, COUNT(*) AS c FROM sessions WHERE hidden = 0 GROUP BY source")}
    return {"total": row["total"], "input_tokens": row["in_tok"],
            "output_tokens": row["out_tok"], "by_source": by_source}


def session_messages(session_id: str, limit: int = 200) -> list[dict]:
    with _state() as conn:
        rows = conn.execute(
            "SELECT role, content, timestamp, token_count FROM messages "
            "WHERE session_id = ? AND role IN ('user','assistant') AND content IS NOT NULL "
            "AND content != '' ORDER BY timestamp LIMIT ?",
            (session_id, limit)).fetchall()
    return [dict(r) for r in rows]


def newest_oneshot_since(marker_ts: float) -> str | None:
    """Session id of the newest source='oneshot' session started after marker_ts.

    Used by the chat runner for session continuity (pattern verified by HCC).
    """
    try:
        with _state() as conn:
            row = conn.execute(
                "SELECT id FROM sessions WHERE source = 'oneshot' AND started_at > ? "
                "ORDER BY started_at DESC LIMIT 1", (marker_ts,)).fetchone()
        return row["id"] if row else None
    except (FileNotFoundError, sqlite3.Error):
        return None


def oneshot_session_alive(session_id: str) -> bool:
    try:
        with _state() as conn:
            row = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return row is not None
    except (FileNotFoundError, sqlite3.Error):
        return False


# ------------------------------------------------------------------ cron executions

def cron_executions(job_id: str = "", limit: int = 50) -> list[dict]:
    path = config.HERMES_HOME / "cron" / "executions.db"
    try:
        conn = _ro(path)
    except FileNotFoundError:
        return []
    try:
        where, params = [], []
        if job_id:
            where.append("job_id = ?")
            params.append(job_id)
        sql = ("SELECT id, job_id, status, started_at, finished_at, error, scheduled_instant "
               f"FROM executions {'WHERE ' + ' AND '.join(where) if where else ''} "
               "ORDER BY COALESCE(started_at, claimed_at) DESC LIMIT ?")
        params.append(limit)
        return [dict(r) for r in conn.execute(sql, params)]
    except sqlite3.Error:
        return []
    finally:
        conn.close()


# ------------------------------------------------------------------ scheduler heartbeat

def scheduler_heartbeat() -> dict:
    """Evidence from cron ticker files; unknown when files are absent."""
    hb = config.HERMES_HOME / "cron" / "ticker_last_success"
    if not hb.exists():
        return {"status": "unknown", "detail": "no scheduler heartbeat file"}
    age = time.time() - hb.stat().st_mtime
    if age < 900:
        status = "operational"
    elif age < 3600:
        status = "degraded"
    else:
        status = "offline"
    return {"status": status, "detail": f"last scheduler tick {int(age)}s ago"}


# ------------------------------------------------------------------ overview payload

def overview_metrics() -> dict:
    try:
        return session_stats()
    except (FileNotFoundError, sqlite3.Error):
        return {"total": 0, "input_tokens": 0, "output_tokens": 0, "by_source": {}, "unavailable": True}


def session_json_default(o):
    if isinstance(o, (bytes,)):
        return o.decode(errors="replace")
    return json.dumps(o)
