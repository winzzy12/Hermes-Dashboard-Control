"""System health probes — every status is backed by a real check."""
import subprocess
import time

import httpx

from .. import config, db
from . import cli, store


def _probe(name: str, fn) -> dict:
    start = time.monotonic()
    try:
        result = fn()
        latency = round((time.monotonic() - start) * 1000)
        return {"name": name, "latency_ms": latency, **result}
    except Exception as e:  # noqa: BLE001 — a probe must never take the API down
        latency = round((time.monotonic() - start) * 1000)
        return {"name": name, "status": "offline", "latency_ms": latency,
                "detail": f"{type(e).__name__}: {str(e)[:200]}"}


def _hermes_cli():
    r = subprocess.run([cli.hermes_bin(), "--version"], capture_output=True, text=True, timeout=30)
    version = r.stdout.strip().splitlines()[0] if r.stdout.strip() else ""
    return {"status": "operational", "detail": version or "hermes CLI responded"}


def _agent_status():
    from . import cli as c
    out = c.run_cli_checked(["status"], timeout=60)
    info = {}
    for line in out.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            k = k.strip().lower()
            if k in ("model", "provider", "gateway", "platforms", "jobs"):
                info[k] = v.strip()
    gateway_ok = "✓" in info.get("gateway", "") or "running" in info.get("gateway", "").lower()
    return {"status": "operational" if gateway_ok else "unknown",
            "detail": f"model={info.get('model','?')} provider={info.get('provider','?')} "
                      f"gateway={info.get('gateway','?')} jobs={info.get('jobs','?')}"}


def _sessions_db():
    store.session_stats()
    return {"status": "operational", "detail": str(config.HERMES_HOME / "state.db")}


def _provider_api():
    from . import models as m
    return m.test_provider()


def _scheduler():
    return store.scheduler_heartbeat()


def probe_all() -> dict:
    from concurrent.futures import ThreadPoolExecutor

    checks_def = [
        ("hermes_cli", _hermes_cli),
        ("agent", _agent_status),
        ("sessions_db", _sessions_db),
        ("model_provider", _provider_api),
        ("scheduler", _scheduler),
    ]
    with ThreadPoolExecutor(max_workers=len(checks_def)) as ex:
        futures = {ex.submit(_probe, name, fn): name for name, fn in checks_def}
        checks = [f.result() for f in futures]  # submitted in order → results in order
    for c in checks:
        db.record_health(c["name"], c["status"], c.get("latency_ms"), c.get("detail", ""))
    worst = "operational"
    rank = {"operational": 0, "unknown": 1, "degraded": 2, "offline": 3}
    for c in checks:
        if rank.get(c["status"], 1) > rank[worst]:
            worst = c["status"]
    return {"checked_at": time.time(), "overall": worst, "services": checks,
            "mode": config.MODE}


def health_history(limit: int = 120) -> list[dict]:
    rows = db.q("SELECT ts, name, status, latency_ms FROM health_checks ORDER BY id DESC LIMIT ?",
                (limit,))
    return [dict(r) for r in reversed(rows)]
