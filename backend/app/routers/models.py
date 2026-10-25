"""Models: inventory from the agent's real config + provider cache."""
from fastapi import APIRouter, Depends, HTTPException

from .. import security
from ..hermes import models as hermes_models
from ..hermes.cli import HermesError

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("")
def get_models(user: dict = Depends(security.require_user)):
    try:
        mc = hermes_models.model_config()
    except hermes_models.ModelsError as e:
        raise HTTPException(status_code=502, detail=str(e))
    providers = hermes_models.provider_models()
    return {"config": mc, "providers": providers}


@router.post("/test")
def test_provider(user: dict = Depends(security.require_user)):
    """Connectivity test against the configured provider base_url. Key stays server-side."""
    return hermes_models.test_provider()


@router.post("/default")
def set_default(body: dict, user: dict = Depends(security.require_user)):
    name = (body.get("model") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="model required")
    if not body.get("confirm"):
        raise HTTPException(status_code=400, detail="Changing the agent's default model requires confirm=true")
    try:
        hermes_models.set_default_model(name)
    except hermes_models.ModelsError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HermesError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True}
