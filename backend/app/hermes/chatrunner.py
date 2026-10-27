"""Chat execution against the real Hermes agent (streaming).

Engine: hermes chat -q <msg> --oneshot --format stream-json
- JSONL events on stdout: system/init → text deltas → tool_use/tool_result → result
- Full agent (tools/skills/memory) with per-token streaming
- Continuity: --resume <session-id> (no -m on resume; hermes rejects overrides)
- --reasoning <level>: thinking effort (dashboard default "minimal" = fastest first token)

Per-message subscribers receive SSE-ready dicts from the reader thread:
  {"event": "init"|"delta"|"tool"|"done"|"error"|"stopped", "data": {...}}
The terminal event (done/error/stopped) is published only AFTER the DB row is
finalized, so a client that reloads on that event always sees the final state.
"""
import asyncio
import json
import subprocess
import threading
import time
from typing import Optional

from .. import config, db
from . import cli

_procs: dict[int, subprocess.Popen] = {}
_threads: dict[int, threading.Thread] = {}
_subs: dict[int, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
_stops: set[int] = set()
_lock = threading.Lock()


def subscribe(msg_id: int, loop: asyncio.AbstractEventLoop) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    with _lock:
        _subs.setdefault(msg_id, []).append((loop, q))
    return q


def unsubscribe(msg_id: int, q: asyncio.Queue) -> None:
    with _lock:
        lst = _subs.get(msg_id)
        if lst:
            _subs[msg_id] = [x for x in lst if x[1] is not q]


def _publish(msg_id: int, event: str, data: dict) -> None:
    with _lock:
        subs = list(_subs.get(msg_id, ()))
    for loop, q in subs:
        try:
            loop.call_soon_threadsafe(q.put_nowait, {"event": event, "data": data})
        except RuntimeError:
            pass  # event loop closed


def _finalize(msg_id: int, status: str, content: str = "", error: str = "") -> None:
    db.update_message(msg_id, status=status, content=content or "",
                      error=(error or "")[:1000] or None, finished_at=time.time())


def parse_jsonl_line(line: str) -> Optional[dict]:
    """Parse one stream-json line into a normalized event dict, or None."""
    line = (line or "").strip()
    if not line:
        return None
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        return None
    t = ev.get("type")
    if t == "system":
        return {"event": "init", "data": {"model": ev.get("model", ""), "session_id": ev.get("session_id", "")}}
    if t == "text":
        return {"event": "delta", "data": {"t": ev.get("text", "")}}
    if t == "reasoning":
        # [hermes-dashboard local patch in hermes_cli] provider thinking tokens streamed live.
        return {"event": "reasoning", "data": {"t": ev.get("text", "")}}
    if t == "tool_use":
        return {"event": "tool", "data": {"name": ev.get("name", "unknown"), "state": "started"}}
    if t == "tool_result":
        return {"event": "tool", "data": {"name": ev.get("name", "unknown"), "state": "done",
                                          "is_error": bool(ev.get("is_error")),
                                          "duration_ms": ev.get("duration_ms")}}
    if t == "result":
        return {"event": "done", "data": {"text": ev.get("text", ""),
                                          "session_id": ev.get("session_id", ""),
                                          "tokens": ev.get("tokens", {}),
                                          "error": ev.get("error", ""),
                                          "exit_code": ev.get("exit_code", 0)}}
    return None


def _runner(msg_id: int, conversation_id: str, text: str, model: str,
            hermes_session_id: str, reasoning: str) -> None:
    if hermes_session_id:
        db.update_message(msg_id, hermes_session_id=hermes_session_id)
    argv = [cli.hermes_bin(), "chat", "-q", text, "--oneshot", "--format", "stream-json"]
    if hermes_session_id:
        argv += ["--resume", hermes_session_id]
    elif model:
        argv += ["-m", model]
    if reasoning:
        argv += ["--reasoning", reasoning]
    session_id = hermes_session_id
    buf: list[str] = []
    got_result = False
    result_error = ""
    err_tail: list[str] = []
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, start_new_session=True)
    except OSError as e:
        _finalize(msg_id, "error", error=f"failed to start hermes: {e}")
        _publish(msg_id, "error", {"detail": f"failed to start hermes: {e}"})
        return
    with _lock:
        _procs[msg_id] = proc

    def _watchdog() -> None:
        deadline = time.time() + config.CHAT_TIMEOUT_SECONDS
        while proc.poll() is None:
            if time.time() > deadline:
                try:
                    proc.kill()
                except OSError:
                    pass
                return
            time.sleep(1)

    threading.Thread(target=_watchdog, daemon=True).start()
    try:
        for line in proc.stdout:
            ev = parse_jsonl_line(line)
            if not ev:
                continue
            kind = ev["event"]
            if kind == "init":
                _publish(msg_id, "init", {"message_id": msg_id, **ev["data"]})
            elif kind == "delta":
                buf.append(ev["data"]["t"])
                _publish(msg_id, kind, ev["data"])
            elif kind == "reasoning":
                _publish(msg_id, kind, ev["data"])
            elif kind == "tool":
                _publish(msg_id, kind, ev["data"])
            elif kind == "done":
                got_result = True
                if ev["data"]["text"]:
                    buf = [ev["data"]["text"]]  # terminal envelope is authoritative
                if ev["data"]["session_id"]:
                    session_id = ev["data"]["session_id"]
                if ev["data"]["error"]:
                    result_error = ev["data"]["error"]
        proc.wait(timeout=30)
        exit_code = proc.returncode
        err_tail = (proc.stderr.read() or "").strip().splitlines()[-3:]
    except Exception:
        proc.kill()
        exit_code = -1
    finally:
        content = "".join(buf)
        if msg_id in _stops:
            _finalize(msg_id, "stopped", content=content)
            _publish(msg_id, "stopped", {"content": content})
        elif got_result and not result_error:
            _finalize(msg_id, "done", content=content)
            if session_id:
                if not hermes_session_id:
                    db.set_conversation_session(conversation_id, session_id)
                db.update_message(msg_id, hermes_session_id=session_id)
            _publish(msg_id, "done", {"text": content, "session_id": session_id,
                                      "tokens": {}, "error": "", "exit_code": 0})
        else:
            detail = result_error or (" | ".join(err_tail)[:400] if err_tail else f"exit code {exit_code}")
            _finalize(msg_id, "error", content=content, error=f"hermes failed: {detail}")
            _publish(msg_id, "error", {"detail": f"hermes failed: {detail}"})
        with _lock:
            _procs.pop(msg_id, None)
            _threads.pop(msg_id, None)
            _subs.pop(msg_id, None)
            _stops.discard(msg_id)


def start_message(msg_id: int, conversation_id: str, text: str, model: str,
                  hermes_session_id: str, reasoning: str = "") -> None:
    t = threading.Thread(target=_runner,
                         args=(msg_id, conversation_id, text, model, hermes_session_id, reasoning),
                         daemon=True)
    with _lock:
        _threads[msg_id] = t
    t.start()


def stop_message(msg_id: int) -> bool:
    """Kill the agent process; the reader thread finalizes the row (status=stopped,
    keeping any partial content) and publishes the terminal 'stopped' event."""
    with _lock:
        proc = _procs.get(msg_id)
    if proc is None:
        return False
    _stops.add(msg_id)
    try:
        proc.terminate()
    except OSError:
        pass

    def _kill_later() -> None:
        time.sleep(4)
        if proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass

    threading.Thread(target=_kill_later, daemon=True).start()
    return True


def running_ids() -> set[int]:
    with _lock:
        return set(_procs.keys())
