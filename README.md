# Hermes Control

Centralized dashboard for the local **Hermes Agent** — chat, skills, cronjobs, models, and
system monitoring in a Linear-inspired interface.

**Mandatory local URL: http://localhost:8089** (bound to 127.0.0.1)

```
FastAPI (backend/)  ── serves REST API under /api/* and the built SPA
React 19 + Vite + TS + Tailwind (frontend/)  ── Linear-inspired UI, light/dark
Hermes Agent v0.22+ (real integration)  ── hermes CLI + agent state stores
```

## Stack note

The reference spec preferred Next.js; this implementation uses **FastAPI + React (Vite)** —
the same proven stack as the other dashboards on this box — because every integration path
is subprocess/SQLite based (`hermes -z`, `state.db`, `cron/jobs.json`), which is natural in
Python/FastAPI and keeps the build light. The UI matches the spec's design tokens,
structure, and feature list; dev/build commands are the framework equivalents.

## Quick start (production-style, verified)

```bash
# 1. backend
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. frontend
cd ../frontend
npm install
npm run build          # tsc --noEmit + vite build → dist/

# 3. run (serves API + SPA on 127.0.0.1:8089)
cd ../backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8089
```

Open **http://localhost:8089** — first run shows *first-run setup* to create the admin
account (or use the bundled systemd unit: `deploy/hermes-dashboard.service`).

## Development workflow

```bash
# terminal 1 — API on 8089 (auto-reload)
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8089

# terminal 2 — Vite dev server on 5173 (proxies /api → 8089)
cd frontend && npm run dev
```

Open http://localhost:5173. The session cookie stays same-origin via the proxy.

## Checks

```bash
cd frontend && npm run typecheck      # tsc --noEmit
cd backend  && .venv/bin/python -m pytest -q
```

## Configuration

Copy `.env.example` when overriding defaults (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8089` / `127.0.0.1` | dashboard bind (loopback only by default) |
| `HERMES_MODE` | `real` | `real` (verified CLI integration) or `mock` (UI dev fixtures) |
| `HERMES_HOME` | `~/.hermes` | Hermes profile to read |
| `HERMES_BIN` | auto-detected | explicit hermes binary path |
| `CHAT_TIMEOUT_SECONDS` | `900` | hard cap per chat generation |

The dashboard's own data lives in `backend/data/dashboard.db` (users, conversations,
messages, health history). The JWT signing key is `backend/.secret` (chmod 600,
auto-generated). **No secrets are stored or exposed client-side** — provider API keys stay
in the agent's `~/.hermes/.env` and are only used server-side for the connectivity test.

## Feature status (verified on this box)

| Feature | Status |
|---|---|
| Login / first-run setup / logout / password change | ✅ PBKDF2 + JWT HttpOnly cookie, login rate limit |
| Chat with the real agent | ✅ `hermes -z` + `--resume` session continuity, stop generation, markdown + code highlight |
| Conversation management | ✅ create / rename / delete / search (dashboard store) |
| Recents | ✅ agent sessions (state.db), dashboard chats, cron executions |
| Skills | ✅ list / search / detail from installed SKILL.md + CLI status |
| Cronjobs | ✅ list / create / pause / resume / run / delete via `hermes cron`, executions history, schedule preview |
| Models | ✅ config + provider model cache, connectivity test, set default model (confirm-gated) |
| System status | ✅ 5 real probes with latency + history, 30s auto-refresh |
| Settings | ✅ profile, default chat model, theme, password |
| Command palette | ✅ Ctrl/Cmd+K |

Known limitations (by design, shown in the UI):

- Skills enable/disable is interactive-only in Hermes (`hermes skills config`) — shown read-only.
- Skills are not executed from the dashboard; use "Run via chat".
- Chat streaming is not available (the CLI emits only the final reply) — the UI polls instead.
- Cronjob edit of schedule/prompt is supported through the API; the UI routes complex edits to the CLI.

See `docs/INTEGRATION.md` for the exact verified Hermes interfaces.
