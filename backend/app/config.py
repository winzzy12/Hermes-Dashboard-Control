"""Application settings — all defaults bind to localhost:8089."""
import os
import pathlib

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent  # backend/
REPO_DIR = BASE_DIR.parent

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8089"))

# Dashboard's own SQLite store (users, conversations, chat messages, health history)
DATA_DIR = pathlib.Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "dashboard.db"

# Hermes installation (default profile = $HERMES_HOME or ~/.hermes)
HERMES_HOME = pathlib.Path(os.environ.get("HERMES_HOME", pathlib.Path.home() / ".hermes"))
HERMES_BIN = os.environ.get("HERMES_BIN", "")  # optional explicit override

# Integration mode: "real" (verified hermes CLI + state.db) or "mock" (typed fixtures).
# Production must use "real"; mock exists only for UI development without a Hermes install.
MODE = os.environ.get("HERMES_MODE", "real").strip().lower()
if MODE not in ("real", "mock"):
    raise RuntimeError(f"HERMES_MODE must be 'real' or 'mock', got {MODE!r}")

# Frontend build output served by this API in production
FRONTEND_DIST = pathlib.Path(os.environ.get("FRONTEND_DIST", REPO_DIR / "frontend" / "dist"))

TOKEN_TTL_SECONDS = 24 * 60 * 60
COOKIE_NAME = "hd_session"

# Chat runner limits
CHAT_TIMEOUT_SECONDS = int(os.environ.get("CHAT_TIMEOUT_SECONDS", "900"))

# Secret file for JWT signing (auto-generated, chmod 600)
SECRET_FILE = BASE_DIR / ".secret"
