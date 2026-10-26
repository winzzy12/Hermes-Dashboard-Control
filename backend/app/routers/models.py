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
    return {"config": mc, "providers": providers, "custom_models": hermes_models.custom_models()}


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


# ------------------------------------------------------ named custom models

@router.post("/custom")
def add_custom_model(body: dict, user: dict = Depends(security.require_user)):
    """Create or update a named custom model (base_url + api_key + model id).

    The API key is stored in $HERMES_HOME/.env and referenced by key_env — it is
    never written to config.yaml and never returned by any endpoint.
    """
    try:
        return hermes_models.add_custom_model(
            name=body.get("name") or "",
            model=body.get("model") or "",
            base_url=body.get("base_url") or "",
            api_key=body.get("api_key") or "",
            set_default=bool(body.get("set_default")),
        )
    except hermes_models.ModelsError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HermesError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/custom/{name}/test")
def test_custom_model(name: str, user: dict = Depends(security.require_user)):
    """Connectivity test of a stored custom model; key resolved server-side from .env."""
    try:
        return hermes_models.test_custom_model(name)
    except hermes_models.ModelsError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/custom/{name}/activate")
def activate_custom_model(name: str, body: dict, user: dict = Depends(security.require_user)):
    """Make a custom model the agent's active model. Destructive to the previous route."""
    if not (body or {}).get("confirm"):
        raise HTTPException(status_code=400, detail="Activating a custom model requires confirm=true")
    try:
        hermes_models.activate_custom_model(name)
    except hermes_models.ModelsError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HermesError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True}


@router.delete("/custom/{name}")
def delete_custom_model(name: str, confirm: bool = False, user: dict = Depends(security.require_user)):
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass confirm=true to delete a custom model")
    try:
        hermes_models.delete_custom_model(name)
    except hermes_models.ModelsError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HermesError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True}
