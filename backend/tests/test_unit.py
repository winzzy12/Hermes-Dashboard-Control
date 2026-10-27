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


# ---------------------------------------------------------------- files

def test_files_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.DB_PATH", tmp_path / "t.db")
    db._initialized = False
    if getattr(db._local, "conn", None) is not None:
        db._local.conn.close()
        db._local.conn = None
    from fastapi.testclient import TestClient
    from app.main import app
    from app import config

    root = tmp_path / "fsroot"
    (root / "sub").mkdir(parents=True)
    (root / "hello.txt").write_text("hello world")
    (root / "sub" / "a.bin").write_bytes(b"\x00\x01\x02")

    client = TestClient(app)
    with client:
        # unauthenticated -> 401
        assert client.get(f"/api/files?path={root}").status_code == 401

        uid = db.create_user("wanz", security.hash_password("x"))
        token = security.make_token(uid, "wanz", 1)
        client.cookies.set(config.COOKIE_NAME, token)

        # list
        r = client.get(f"/api/files?path={root}")
        assert r.status_code == 200
        body = r.json()
        names = [e["name"] for e in body["entries"]]
        assert "sub" in names and "hello.txt" in names
        assert body["parent"] == str(root.parent)

        # view text + binary
        v = client.get(f"/api/files/view?path={root}/hello.txt").json()
        assert v["binary"] is False and v["content"] == "hello world"
        b = client.get(f"/api/files/view?path={root}/sub/a.bin").json()
        assert b["binary"] is True and b["content"] is None

        # edit: overwrite without confirm -> 400, with confirm -> ok
        r = client.put("/api/files", json={"path": f"{root}/hello.txt", "content": "new"})
        assert r.status_code == 400
        r = client.put("/api/files", json={"path": f"{root}/hello.txt", "content": "new", "confirm": True})
        assert r.status_code == 200
        assert (root / "hello.txt").read_text() == "new"

        # upload: ok, then duplicate -> 409
        files = {"file": ("up.txt", b"upload-data", "text/plain")}
        r = client.post(f"/api/files/upload?path={root}", files=files)
        assert r.status_code == 200
        assert (root / "up.txt").read_bytes() == b"upload-data"
        r = client.post(f"/api/files/upload?path={root}", files=files)
        assert r.status_code == 409

        # download
        r = client.get(f"/api/files/download?path={root}/up.txt")
        assert r.status_code == 200 and r.content == b"upload-data"

        # delete: without confirm -> 400, with confirm -> gone
        r = client.delete(f"/api/files?path={root}/up.txt")
        assert r.status_code == 400
        r = client.delete(f"/api/files?path={root}/sub&confirm=true")
        assert r.status_code == 200 and not (root / "sub").exists()

        # protected path
        assert client.delete("/api/files?path=/&confirm=true").status_code == 403

        # bad path
        assert client.get(f"/api/files?path={root}/nope").status_code == 404


# ---------------------------------------------------------------- chat runner

def test_build_prompt_attachments(tmp_path):
    from app.hermes.chatrunner import build_prompt

    # text file embedded as a fenced block
    f = tmp_path / "notes.txt"
    f.write_text("alpha line\nbeta line\n")
    p = build_prompt("summarize this", [{"name": "notes.txt", "path": str(f), "is_image": False, "id": "x", "size": 22}])
    assert p.startswith("summarize this")
    assert "[Attached file: notes.txt (21 B)]" in p and "```txt\nalpha line\nbeta line\n```" in p

    # image referenced by path with vision_analyze instruction
    p = build_prompt("what is this", [{"name": "pic.png", "path": "/tmp/pic.png", "is_image": True, "id": "y", "size": 9}])
    assert "[Image attached: pic.png — local path: /tmp/pic.png]" in p and "vision_analyze" in p

    # binary file → notice, no dump
    b = tmp_path / "blob.bin"
    b.write_bytes(b"\x00\x01\xff")
    p = build_prompt("look", [{"name": "blob.bin", "path": str(b), "is_image": False, "id": "z", "size": 3}])
    assert "binary file, content not shown" in p

    # oversized text → truncated at the cap
    big = tmp_path / "big.log"
    big.write_text("x" * 150_000)
    p = build_prompt("check", [{"name": "big.log", "path": str(big), "is_image": False, "id": "w", "size": 150_000}])
    assert "truncated at 100000 chars" in p and len(p) < 120_000

    # unreadable path → notice
    p = build_prompt("go", [{"name": "gone.txt", "path": str(tmp_path / "nope.txt"), "is_image": False, "id": "v", "size": 5}])
    assert "could not be read" in p


def test_chat_attachment_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr("app.routers.chat_attachments.ATTACH_DIR", tmp_path / "att")
    db._initialized = False
    if getattr(db._local, "conn", None) is not None:
        db._local.conn.close()
        db._local.conn = None
    from fastapi.testclient import TestClient
    from app.main import app
    from app import config

    client = TestClient(app)
    with client:
        assert client.post("/api/chat/attachments").status_code == 401  # auth required
        uid = db.create_user("wanz", security.hash_password("x"))
        client.cookies.set(config.COOKIE_NAME, security.make_token(uid, "wanz", 1))

        r = client.post("/api/chat/attachments", files={"files": ("hello world.txt", b"hello world", "text/plain")})
        assert r.status_code == 200
        meta = r.json()[0]
        assert meta["name"] == "hello world.txt" and meta["size"] == 11 and not meta["is_image"]
        aid = meta["id"]
        assert (tmp_path / "att" / aid).is_file()

        # raw serving + traversal rejection
        assert client.get(f"/api/chat/attachments/{aid}/raw").content == b"hello world"
        assert client.get("/api/chat/attachments/../../etc/passwd/raw").status_code in (404, 422)
        assert client.get("/api/chat/attachments/bad-id/raw").status_code == 422

        # image extension classified
        r2 = client.post("/api/chat/attachments", files={"files": ("shot.png", b"\x89PNG fake", "image/png")})
        assert r2.json()[0]["is_image"] is True

        # delete
        assert client.delete(f"/api/chat/attachments/{aid}").json()["ok"] is True
        assert not (tmp_path / "att" / aid).exists()


def test_parse_jsonl_line():
    from app.hermes.chatrunner import parse_jsonl_line
    assert parse_jsonl_line("") is None
    assert parse_jsonl_line("not json") is None
    ev = parse_jsonl_line('{"type": "system", "subtype": "init", "model": "m1", "session_id": "s1", "timestamp": 1}')
    assert ev == {"event": "init", "data": {"model": "m1", "session_id": "s1"}}
    ev = parse_jsonl_line('{"type": "text", "text": "hi", "timestamp": 1}')
    assert ev == {"event": "delta", "data": {"t": "hi"}}
    ev = parse_jsonl_line('{"type": "reasoning", "text": "hmm", "timestamp": 1}')
    assert ev == {"event": "reasoning", "data": {"t": "hmm"}}
    ev = parse_jsonl_line('{"type": "tool_use", "name": "terminal", "timestamp": 1}')
    assert ev["event"] == "tool" and ev["data"]["state"] == "started" and ev["data"]["name"] == "terminal"
    ev = parse_jsonl_line('{"type": "tool_result", "name": "terminal", "is_error": false, "duration_ms": 5, "timestamp": 1}')
    assert ev["data"]["state"] == "done" and ev["data"]["is_error"] is False
    ev = parse_jsonl_line('{"type": "result", "text": "OK", "session_id": "s2", "exit_code": 0, "tokens": {"total": 3}, "timestamp": 1}')
    assert ev["event"] == "done" and ev["data"]["text"] == "OK" and ev["data"]["session_id"] == "s2"
    assert parse_jsonl_line('{"type": "something_else", "timestamp": 1}') is None


# ---------------------------------------------------------------- skills

def test_frontmatter():
    md = "---\nname: my-skill\ndescription: \"Does things\"\n---\n\n# Body\n"
    fm = _frontmatter(md)
    assert fm["name"] == "my-skill" and fm["description"] == "Does things"
    assert _frontmatter("no frontmatter here") == {}
