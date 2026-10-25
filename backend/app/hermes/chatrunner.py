"""Chat execution against the real Hermes agent.

Pattern verified on this box (HCC worker):
- one-shot:        hermes -z <msg>                     → prints ONLY the final reply
- continuity:      hermes --resume <session-id> -z <msg>
- after a fresh run, the newest source='oneshot' row in state.db is the new session id.

Runs in a daemon thread; process handle kept in a registry so the UI can stop
a generation. No streaming — the CLI emits only the final reply, so the UI
shows a running indicator and polls.
"""
import subprocess
import threading
import time

from .. import config, db
from . import cli, store

_procs: dict[int, subprocess.Popen] = {}
_procs_lock = threading.Lock()
_threads: dict[int, threading.Thread] = {}


def _finalize(msg_id: int, status: str, content: str = "", error: str = "") -> None:
    db.update_message(msg_id, status=status, content=content or "",
                      error=error[:1000] or None, finished_at=time.time())


def _runner(msg_id: int, conversation_id: str, text: str, model: str,
            hermes_session_id: str) -> None:
    fresh = not hermes_session_id
    if hermes_session_id:
        db.update_message(msg_id, hermes_session_id=hermes_session_id)
    argv = [cli.hermes_bin()]
    if hermes_session_id:
        # Resume: the session keeps its launch model — passing a different -m is
        # rejected by hermes ("overrides are unsupported on resume").
        argv += ["--resume", hermes_session_id]
    elif model:
        argv += ["-m", model]
    argv += ["-z", text]
    marker = time.time()
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, start_new_session=True)
    except OSError as e:
        _finalize(msg_id, "error", error=f"failed to start hermes: {e}")
        return
    with _procs_lock:
        _procs[msg_id] = proc
    try:
        out, err = proc.communicate(timeout=config.CHAT_TIMEOUT_SECONDS)
        if proc.returncode == 0 and out and out.strip():
            _finalize(msg_id, "done", content=out.strip())
            if fresh:
                sid = store.newest_oneshot_since(marker - 2)
                if sid:
                    db.set_conversation_session(conversation_id, sid)
                    db.update_message(msg_id, hermes_session_id=sid)
        elif proc.returncode == 0:
            _finalize(msg_id, "error", error="hermes returned an empty response")
        else:
            tail = (err or out or "").strip().splitlines()[-3:]
            detail = " | ".join(tail)[:400] if tail else f"exit code {proc.returncode}"
            _finalize(msg_id, "error", error=f"hermes failed: {detail}")
    except subprocess.TimeoutExpired:
        proc.kill()
        _finalize(msg_id, "error", error=f"timed out after {config.CHAT_TIMEOUT_SECONDS}s")
    finally:
        with _procs_lock:
            _procs.pop(msg_id, None)
            _threads.pop(msg_id, None)


def start_message(msg_id: int, conversation_id: str, text: str, model: str,
                  hermes_session_id: str) -> None:
    t = threading.Thread(target=_runner,
                         args=(msg_id, conversation_id, text, model, hermes_session_id),
                         daemon=True)
    with _procs_lock:
        _threads[msg_id] = t
    t.start()


def stop_message(msg_id: int) -> bool:
    with _procs_lock:
        proc = _procs.get(msg_id)
    if proc is None:
        return False
    try:
        proc.terminate()
    except OSError:
        pass

    def _kill_later():
        time.sleep(4)
        if proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass

    threading.Thread(target=_kill_later, daemon=True).start()
    _finalize(msg_id, "stopped")
    return True


def running_ids() -> set[int]:
    with _procs_lock:
        return set(_procs.keys())
