"""System status + health history."""
from fastapi import APIRouter, Depends

from .. import config, security
from ..hermes import health

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/status")
def system_status(user: dict = Depends(security.require_user)):
    return health.probe_all()


@router.get("/history")
def history(limit: int = 120, user: dict = Depends(security.require_user)):
    return health.health_history(limit)
