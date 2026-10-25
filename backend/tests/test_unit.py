"""Unit tests for critical logic (no live agent required)."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db, security  # noqa: E402
from app.hermes.cron import _parse_cli_blocks, schedule_preview  # noqa: E402
from app.hermes.skills import _frontmatter  # noqa: E402


# ---------------------------------------------------------------- security

def test_password_roundtrip():
    h = security.hash_password("s3cret-pass")
    assert h.startswith("pbkdf2_sha256$")
    assert security.verify_password("s3cret-pass", h)
    assert not security.verify_password("wrong", h)


def test_token_roundtrip_and_version():
    tok = security.make_token(7, "wanz", 3)
    payload = security.decode_token(tok)
    assert payload["sub"] == "7" and payload["username"] == "wanz" and payload["ver"] == 3
    assert security.decode_token(tok + "x") is None


def test_rate_limit_blocks_after_max():
    key = f"test-ip-{time.time()}"
    for _ in range(security._MAX_ATTEMPTS):
        security.record_attempt(key, False)
    try:
        security.check_rate_limit(key)
        raised = False
    except Exception:
        raised = True
    assert raised


# ---------------------------------------------------------------- db

def test_conversation_message_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.DB_PATH", tmp_path / "t.db")
    db._initialized = False
    if getattr(db._local, "conn", None) is not None:
        db._local.conn.close()
        db._local.conn = None
    db.init()
    cid = db.new_conversation("Test conv")
    m1 = db.add_message(cid, "user", "hello")
    m2 = db.add_message(cid, "assistant", "", status="pending")
    db.update_message(m2, status="done", content="hi", finished_at=time.time())
    msgs = db.conversation_messages(cid)
    assert len(msgs) == 2 and msgs[1]["content"] == "hi" and msgs[1]["status"] == "done"
    db.rename_conversation(cid, "Renamed")
    db.set_conversation_session(cid, "sess-123")
    conv = db.one("SELECT * FROM conversations WHERE id = ?", (cid,))
    assert conv["title"] == "Renamed" and conv["hermes_session_id"] == "sess-123"
    db.delete_conversation(cid)
    assert db.one("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?", (cid,))["c"] == 0


# ---------------------------------------------------------------- cron

def test_parse_cli_blocks():
    out = """
┌──────────────────────────────────────┐
│        Scheduled Jobs (profile: default) │
└──────────────────────────────────────┘

  2a27aa3b8122 [paused]
    Name:      hd-test-job
    Schedule:  0 9 * * *
    Deliver:   origin

  f1f2f3f4f5f6 [active]
    Name:      nightly
    Schedule:  every 2h
"""
    jobs = _parse_cli_blocks(out)
    assert len(jobs) == 2
    assert jobs[0]["id"] == "2a27aa3b8122" and jobs[0]["status"] == "paused"
    assert jobs[0]["schedule"] == "0 9 * * *" and jobs[0]["deliver"] == "origin"
    assert jobs[1]["status"] == "active" and jobs[1]["enabled"] is True


def test_schedule_preview_cron():
    r = schedule_preview("0 9 * * *")
    assert r["valid"] and r["kind"] == "cron" and len(r["next"]) == 3


def test_schedule_preview_interval():
    r = schedule_preview("every 2h")
    assert r["valid"] and r["kind"] == "interval" and len(r["next"]) == 3
    r2 = schedule_preview("30m")
    assert r2["valid"] and r2["kind"] == "interval"


def test_schedule_preview_iso():
    r = schedule_preview("2026-11-01T09:00:00")
    assert r["valid"] and r["kind"] == "timestamp"


def test_schedule_preview_invalid():
    r = schedule_preview("not a schedule")
    assert not r["valid"] and r["error"]


# ---------------------------------------------------------------- skills

def test_frontmatter():
    md = "---\nname: my-skill\ndescription: \"Does things\"\n---\n\n# Body\n"
    fm = _frontmatter(md)
    assert fm["name"] == "my-skill" and fm["description"] == "Does things"
    assert _frontmatter("no frontmatter here") == {}
