"""Hermes Control API — FastAPI app.

Serves the REST API under /api/* and the built SPA (frontend/dist) on the same
origin, bound to 127.0.0.1:8089 by default.
"""
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .routers import auth, chat, cronjobs, models, overview, settings, skills, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("hermes-dashboard")

app = FastAPI(title="Hermes Control", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(overview.router)
app.include_router(skills.router)
app.include_router(cronjobs.router)
app.include_router(models.router)
app.include_router(system.router)
app.include_router(settings.router)


@app.on_event("startup")
def startup() -> None:
    db.init()
    log.info("Hermes Control starting: mode=%s port=%d hermes_home=%s",
             config.MODE, config.PORT, config.HERMES_HOME)


@app.get("/api/health")
def api_health():
    """Unauthenticated liveness of the dashboard process itself."""
    return {"ok": True, "mode": config.MODE}


# ------------------------------------------------------------- SPA serving
_dist = config.FRONTEND_DIST
if _dist.is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
else:
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_missing(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return JSONResponse({"detail": "Frontend not built. Run: cd frontend && npm run build"},
                            status_code=503)
