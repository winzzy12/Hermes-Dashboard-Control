"""Dashboard's own SQLite store: users, conversations, messages, health history, kv."""
import json
import pathlib
import sqlite3
import threading
import time
import uuid

from . import config

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    default_model TEXT DEFAULT '',
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    hermes_session_id TEXT,
    model TEXT DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done',
    error TEXT,
    model TEXT DEFAULT '',
    hermes_session_id TEXT,
    created_at REAL NOT NULL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms REAL,
    detail TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_health_ts ON health_checks(ts DESC);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(config.DB_PATH), timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def init() -> None:
    global _initialized
    with _init_lock:
        if _initialized:
            return
        conn = connect()
        conn.executescript(SCHEMA)
        conn.commit()
        _initialized = True


def q(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, params).fetchall()


def one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    return connect().execute(sql, params).fetchone()


def execute(sql: str, params: tuple = ()) -> int:
    conn = connect()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid


# ------------------------------------------------------------------ users

def users_count() -> int:
    return one("SELECT COUNT(*) AS c FROM users")["c"]


def create_user(username: str, password_hash: str, display_name: str = "") -> int:
    return execute(
        "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?,?,?,?)",
        (username, password_hash, display_name, time.time()),
    )


def get_user(username: str):
    return one("SELECT * FROM users WHERE username = ?", (username,))


def get_user_by_id(user_id: int):
    return one("SELECT * FROM users WHERE id = ?", (user_id,))


def update_user(user_id: int, **fields) -> None:
    allowed = ("display_name", "default_model", "password_hash", "token_version")
    sets, params = [], []
    for k, v in fields.items():
        if k not in allowed or v is None:
            continue
        sets.append(f"{k} = ?")
        params.append(v)
    if not sets:
        return
    params.append(user_id)
    execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", tuple(params))


# ------------------------------------------------------------------ conversations / messages

def new_conversation(title: str, model: str = "") -> str:
    cid = uuid.uuid4().hex[:12]
    now = time.time()
    execute(
        "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?,?,?,?,?)",
        (cid, title, model, now, now),
    )
    return cid


def touch_conversation(cid: str) -> None:
    execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (time.time(), cid))


def rename_conversation(cid: str, title: str) -> None:
    execute("UPDATE conversations SET title = ? WHERE id = ?", (title, cid))


def set_conversation_session(cid: str, hermes_session_id: str) -> None:
    execute("UPDATE conversations SET hermes_session_id = ? WHERE id = ?", (hermes_session_id, cid))


def delete_conversation(cid: str) -> None:
    execute("DELETE FROM messages WHERE conversation_id = ?", (cid,))
    execute("DELETE FROM conversations WHERE id = ?", (cid,))


def add_message(conversation_id: str, role: str, content: str, status: str = "done",
                model: str = "", created_at: float | None = None) -> int:
    return execute(
        "INSERT INTO messages (conversation_id, role, content, status, model, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (conversation_id, role, content, status, model, created_at or time.time()),
    )


def update_message(msg_id: int, **fields) -> None:
    allowed = ("content", "status", "error", "hermes_session_id", "finished_at", "model")
    sets, params = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        sets.append(f"{k} = ?")
        params.append(v)
    if not sets:
        return
    params.append(msg_id)
    execute(f"UPDATE messages SET {', '.join(sets)} WHERE id = ?", tuple(params))


def get_message(msg_id: int):
    return one("SELECT * FROM messages WHERE id = ?", (msg_id,))


def conversation_messages(cid: str) -> list[sqlite3.Row]:
    return q("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id", (cid,))


# ------------------------------------------------------------------ health history

def record_health(name: str, status: str, latency_ms: float | None, detail: str = "") -> None:
    execute(
        "INSERT INTO health_checks (ts, name, status, latency_ms, detail) VALUES (?,?,?,?,?)",
        (time.time(), name, status, latency_ms, detail[:500]),
    )
    execute(
        "DELETE FROM health_checks WHERE id NOT IN "
        "(SELECT id FROM health_checks ORDER BY id DESC LIMIT 2000)"
    )


# ------------------------------------------------------------------ kv

def kv_set(key: str, value) -> None:
    execute(
        "INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def kv_get(key: str, default=None):
    row = one("SELECT value FROM kv WHERE key = ?", (key,))
    return json.loads(row["value"]) if row else default
