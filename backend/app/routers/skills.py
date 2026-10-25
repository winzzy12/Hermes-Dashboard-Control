"""Skills inspection. Execution/enable-disable are not exposed as unrestricted
endpoints — skills run by asking the agent in Chat; enable/disable is done via
`hermes skills config` (interactive). The UI states this explicitly."""
from fastapi import APIRouter, Depends, HTTPException

from .. import security
from ..hermes import skills as hermes_skills

router = APIRouter(prefix="/api/skills", tags=["skills"])


@router.get("")
def list_skills(user: dict = Depends(security.require_user)):
    return hermes_skills.list_skills()


@router.get("/{slug}")
def skill_detail(slug: str, user: dict = Depends(security.require_user)):
    detail = hermes_skills.skill_detail(slug)
    if detail is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return detail
