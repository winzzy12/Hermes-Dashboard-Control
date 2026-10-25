"""Cronjobs via Hermes' scheduler.

Primary source: $HERMES_HOME/cron/jobs.json (structured job definitions,
written by the hermes scheduler). Mutations go through the hermes CLI
(`hermes cron create/edit/pause/resume/run/remove`). If jobs.json is absent
(older hermes), list_jobs falls back to parsing `hermes cron list` output.
"""
import json
import re
from datetime import datetime, timedelta, timezone

from .. import config
from . import cli


class CronError(RuntimeError):
    pass


def _jobs_json() -> list[dict]:
    p = config.HERMES_HOME / "cron" / "jobs.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return []
    if isinstance(data, dict):
        return data.get("jobs", []) or []
    return data if isinstance(data, list) else []


def _normalize(j: dict) -> dict:
    return {
        "id": j.get("id", ""),
        "name": j.get("name") or j.get("id", ""),
        "prompt": j.get("prompt") or "",
        "schedule": j.get("schedule_display") or (j.get("schedule") or {}).get("display", ""),
        "status": j.get("state") or ("active" if j.get("enabled") else "paused"),
        "enabled": bool(j.get("enabled")),
        "next_run": j.get("next_run_at"),
        "last_run": j.get("last_run_at"),
        "last_status": j.get("last_status"),
        "last_error": j.get("last_error"),
        "deliver": j.get("deliver", ""),
        "created_at": j.get("created_at"),
        "paused_reason": j.get("paused_reason"),
    }


def _parse_cli_blocks(out: str) -> list[dict]:
    """Fallback parser for `hermes cron list` block output."""
    jobs: list[dict] = []
    cur: dict | None = None
    for line in out.splitlines():
        head = re.match(r"^\s{1,4}([0-9a-zA-Z_-]{6,})\s*\[(\w+)\]", line)
        if head:
            if cur:
                jobs.append(cur)
            cur = {"id": head.group(1), "status": head.group(2).lower(),
                   "name": head.group(1), "prompt": "", "schedule": "",
                   "enabled": head.group(2).lower() != "paused", "next_run": None,
                   "last_run": None, "last_status": None, "last_error": None,
                   "deliver": "", "created_at": None, "paused_reason": None}
            continue
        if cur:
            kv = re.match(r"^\s*(\w[\w ]*):\s+(.*)$", line)
            if kv:
                k, v = kv.group(1).strip().lower(), kv.group(2).strip()
                if k == "name":
                    cur["name"] = v
                elif k == "schedule":
                    cur["schedule"] = v
                elif k == "deliver":
                    cur["deliver"] = v
    if cur:
        jobs.append(cur)
    return jobs


def list_jobs(include_disabled: bool = False) -> list[dict]:
    raw = _jobs_json()
    if raw:
        jobs = [_normalize(j) for j in raw]
    else:
        out = cli.run_cli_checked(["cron", "list", "--all"], timeout=60)
        if "no scheduled jobs" in out.lower():
            return []
        jobs = [_normalize({**j}) for j in _parse_cli_blocks(out)]
    if not include_disabled:
        jobs = [j for j in jobs if j["status"] not in ("paused", "completed", "disabled")]
    return jobs


def job_detail(job_id: str) -> dict | None:
    for j in list_jobs(include_disabled=True):
        if j["id"] == job_id:
            return j
    return None


def create_job(schedule: str, prompt: str = "", name: str = "", paused: bool = False,
               deliver: str = "") -> str:
    args = ["cron", "create", schedule]
    if prompt:
        args.append(prompt)
    if name:
        args += ["--name", name]
    if deliver:
        args += ["--deliver", deliver]
    if paused:
        args.append("--paused")
    out = cli.run_cli_checked(args, timeout=60)
    m = re.search(r"Created job:\s*([0-9a-zA-Z_-]{6,})", out)
    if m:
        return m.group(1)
    raise CronError(f"could not parse created job id from output: {out.strip()[:200]}")


def edit_job(job_id: str, schedule: str = "", prompt: str = "", name: str = "") -> None:
    args = ["cron", "edit", job_id]
    if schedule:
        args += ["--schedule", schedule]
    if prompt:
        args += ["--prompt", prompt]
    if name:
        args += ["--name", name]
    cli.run_cli_checked(args, timeout=60)


def pause_job(job_id: str) -> None:
    cli.run_cli_checked(["cron", "pause", job_id], timeout=60)


def resume_job(job_id: str) -> None:
    cli.run_cli_checked(["cron", "resume", job_id], timeout=60)


def run_job(job_id: str) -> None:
    cli.run_cli_checked(["cron", "run", job_id], timeout=300)


def remove_job(job_id: str) -> None:
    cli.run_cli_checked(["cron", "remove", job_id], timeout=60)


def job_executions(job_id: str = "", limit: int = 50) -> list[dict]:
    from . import store
    return store.cron_executions(job_id=job_id, limit=limit)


# ------------------------------------------------------------------ schedule preview

def schedule_preview(schedule: str, occurrences: int = 3) -> dict:
    """Human-readable next occurrences for the editor. Pure function — no scheduler touched."""
    s = (schedule or "").strip()
    now = datetime.now(timezone.utc).astimezone()
    try:
        # ISO timestamp
        try:
            t = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.astimezone()
            return {"valid": True, "kind": "timestamp",
                    "next": [t.isoformat(timespec="seconds")]}
        except ValueError:
            pass
        # interval like '30m', '2h', 'every 2h', '90s', '1d'
        m = re.fullmatch(r"(?:every\s+)?(\d+)\s*([smhd])", s, re.IGNORECASE)
        if m:
            n, unit = int(m.group(1)), m.group(2).lower()
            delta = {"s": timedelta(seconds=n), "m": timedelta(minutes=n),
                     "h": timedelta(hours=n), "d": timedelta(days=n)}[unit]
            nxt, out = now, []
            for _ in range(occurrences):
                nxt += delta
                out.append(nxt.isoformat(timespec="seconds"))
            return {"valid": True, "kind": "interval", "next": out}
        # 5-field cron
        fields = s.split()
        if len(fields) == 5:
            from croniter import croniter
            it = croniter(s, now)
            return {"valid": True, "kind": "cron",
                    "next": [it.get_next(datetime).isoformat(timespec="seconds")
                             for _ in range(occurrences)]}
        return {"valid": False, "kind": None, "next": [],
                "error": "Use an interval ('30m', 'every 2h'), a 5-field cron expression, or an ISO timestamp"}
    except Exception as e:  # noqa: BLE001
        return {"valid": False, "kind": None, "next": [], "error": str(e)[:200]}
