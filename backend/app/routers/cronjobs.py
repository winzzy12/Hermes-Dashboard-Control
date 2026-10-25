"""Cronjobs via the hermes CLI. Destructive actions require an explicit
`confirm` flag in the request body (the UI also asks for confirmation)."""
from fastapi import APIRouter, Depends, HTTPException

from .. import security
from ..hermes import cron as cronmod
from ..hermes.cli import HermesError

router = APIRouter(prefix="/api/cronjobs", tags=["cronjobs"])


def _wrap(fn, *args):
    try:
        return fn(*args) if args else fn()
    except HermesError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("")
def list_jobs(include_disabled: bool = False, user: dict = Depends(security.require_user)):
    jobs = _wrap(cronmod.list_jobs, include_disabled)
    return jobs


@router.get("/executions")
def executions(job_id: str = "", limit: int = 50, user: dict = Depends(security.require_user)):
    return _wrap(cronmod.job_executions, job_id, limit)


@router.get("/schedule-preview")
def schedule_preview(schedule: str, user: dict = Depends(security.require_user)):
    return cronmod.schedule_preview(schedule)


@router.post("")
def create_job(body: dict, user: dict = Depends(security.require_user)):
    schedule = (body.get("schedule") or "").strip()
    if not schedule:
        raise HTTPException(status_code=422, detail="Schedule required (e.g. '30m', '0 9 * * *')")
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="Prompt required (the task the job should do)")
    job_id = _wrap(cronmod.create_job, schedule, prompt[:8000],
                   (body.get("name") or "").strip()[:100], bool(body.get("paused")),
                   (body.get("deliver") or "").strip()[:100])
    return {"id": job_id}


@router.patch("/{job_id}")
def edit_job(job_id: str, body: dict, user: dict = Depends(security.require_user)):
    action = body.get("action")
    if action == "pause":
        _wrap(cronmod.pause_job, job_id)
    elif action == "resume":
        _wrap(cronmod.resume_job, job_id)
    elif action == "run":
        _wrap(cronmod.run_job, job_id)
    elif action == "edit":
        _wrap(cronmod.edit_job, job_id, (body.get("schedule") or "").strip(),
              (body.get("prompt") or "").strip()[:8000], (body.get("name") or "").strip()[:100])
    else:
        raise HTTPException(status_code=422, detail="action must be pause|resume|run|edit")
    return {"ok": True}


@router.delete("/{job_id}")
def remove_job(job_id: str, confirm: bool = False, user: dict = Depends(security.require_user)):
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass confirm=true to delete a job")
    _wrap(cronmod.remove_job, job_id)
    return {"ok": True}
