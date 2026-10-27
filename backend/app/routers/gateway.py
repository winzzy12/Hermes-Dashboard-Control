"""hermes-gateway control: status + restart.

The dashboard backend runs as its own systemd service — OUTSIDE the gateway
daemon — so it can bounce the gateway on the user's behalf (e.g. after patching
hermes CLI code that the long-running gateway holds in memory). The gateway is
a systemd USER unit of root here; the user manager is reached with
XDG_RUNTIME_DIR=/run/user/0, which also works from a system-service context.
"""
import os
import subprocess
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from .. import security

router = APIRouter(prefix="/api/gateway", tags=["gateway"])

UNIT = "hermes-gateway"
RESTART_TIMEOUT_S = 15
ACTIVE_POLL_S = 20


def _sysd(*args: str, user: bool) -> subprocess.CompletedProcess:
    cmd = ["systemctl"]
    env = dict(os.environ)
    if user:
        cmd.append("--user")
        env.setdefault("XDG_RUNTIME_DIR", "/run/user/0")
    return subprocess.run(cmd + list(args), capture_output=True, text=True, timeout=RESTART_TIMEOUT_S, env=env)


def _epoch(ts: str | None) -> int | None:
    """systemd timestamp ('Tue 2026-10-27 19:09:14 CST') → unix epoch; None if unparseable."""
    if not ts:
        return None
    try:
        return int(time.mktime(datetime.strptime(ts, "%a %Y-%m-%d %H:%M:%S %Z").timetuple()))
    except ValueError:
        return None


def _show(kind: str) -> dict:
    p = _sysd("show", UNIT, "-p", "ActiveState", "-p", "ActiveEnterTimestamp", "-p", "MainPID",
              user=(kind == "user"))
    if p.returncode != 0 or "ActiveState=" not in p.stdout:
        return {"unit": UNIT, "kind": kind, "found": False, "active": False, "state": "not-found",
                "since": None, "since_epoch": None, "pid": None}
    f = {}
    for line in p.stdout.strip().splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            f[k] = v
    state = f.get("ActiveState", "unknown")
    pid = int(f["MainPID"]) if f.get("MainPID", "").isdigit() and int(f["MainPID"]) else None
    since = f.get("ActiveEnterTimestamp") or None
    return {"unit": UNIT, "kind": kind, "found": True, "active": state == "active",
            "state": state, "since": since, "since_epoch": _epoch(since), "pid": pid}


def gateway_status() -> dict:
    st = _show("user")
    if not st["found"]:
        st = _show("system")
    return st


@router.get("/status")
def status(user: dict = Depends(security.require_user)):
    return gateway_status()


@router.post("/restart")
def restart(user: dict = Depends(security.require_user)):
    st = gateway_status()
    if not st["found"]:
        raise HTTPException(status_code=404, detail=f"systemd unit {UNIT} not found")
    kind = st["kind"]
    try:
        p = _sysd("restart", UNIT, user=(kind == "user"))
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="systemctl restart timed out")
    if p.returncode != 0:
        raise HTTPException(status_code=502, detail=(p.stderr or p.stdout or "restart failed").strip()[-400:])
    # Wait for the unit to settle (it may be auto-restarting or slow to activate).
    deadline = time.time() + ACTIVE_POLL_S
    final = gateway_status()
    while time.time() < deadline and not final["active"]:
        time.sleep(0.5)
        final = gateway_status()
    return {"ok": final["active"], "status": final}
