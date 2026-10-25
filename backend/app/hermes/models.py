"""Models: read-only view of Hermes model configuration.

Sources:
- config.yaml `model:` section (default model/provider/base_url) — read-only.
- provider_models_cache.json — the model list each provider actually reported.

API keys referenced via ${VAR} are resolved from $HERMES_HOME/.env for the
connectivity test ONLY; they are never returned, logged, or stored.
"""
import json
import os
import re
import time

import httpx
import yaml

from .. import config


class ModelsError(RuntimeError):
    pass


def _env_map() -> dict[str, str]:
    env = {}
    p = config.HERMES_HOME / ".env"
    if p.exists():
        for line in p.read_text(errors="replace").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _resolve_secret(val: str) -> str:
    m = re.fullmatch(r"\$\{([A-Za-z0-9_]+)\}", val or "")
    if m:
        return _env_map().get(m.group(1), "")
    return val or ""


def _load_config() -> dict:
    p = config.HERMES_HOME / "config.yaml"
    if not p.exists():
        raise ModelsError(f"{p} not found")
    data = yaml.safe_load(p.read_text(errors="replace")) or {}
    return data.get("model", {}) or {}


def model_config() -> dict:
    mc = _load_config()
    return {
        "default_model": mc.get("default", ""),
        "provider": mc.get("provider", ""),
        "base_url": mc.get("base_url", ""),
        "has_api_key": bool(_resolve_secret(mc.get("api_key", ""))),
    }


def provider_models() -> list[dict]:
    p = config.HERMES_HOME / "provider_models_cache.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return []
    out = []
    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        provider = key.split(":", 1)[0] if ":" in key else key
        base = key.split(":", 1)[1].split("#", 1)[0] if ":" in key else ""
        out.append({
            "provider": provider,
            "base_url": base,
            "models": entry.get("models", []),
            "fetched_at": entry.get("at"),
            "age_hours": round((time.time() - entry.get("at", 0)) / 3600, 1) if entry.get("at") else None,
        })
    out.sort(key=lambda e: -len(e.get("models", [])))
    return out


def set_default_model(name: str) -> None:
    """Set the agent's default model via the hermes CLI (never edit config.yaml by hand)."""
    from . import cli
    known = {m for entry in provider_models() for m in entry.get("models", [])}
    if known and name not in known:
        raise ModelsError(f"model '{name}' is not in the provider's reported model list")
    cli.run_cli_checked(["config", "set", "model.default", name], timeout=60)


def test_provider() -> dict:
    """GET {base_url}/v1/models with the configured key (server-side only)."""
    mc = _load_config()
    base = (mc.get("base_url") or "").rstrip("/")
    key = _resolve_secret(mc.get("api_key", ""))
    if not base:
        return {"status": "unknown", "detail": "no base_url configured"}
    url = base if base.endswith("/models") else f"{base}/models"
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    start = time.monotonic()
    try:
        r = httpx.get(url, headers=headers, timeout=10)
        latency = round((time.monotonic() - start) * 1000)
        if r.status_code == 200:
            try:
                n = len(r.json().get("data", []))
            except Exception:
                n = None
            return {"status": "operational", "latency_ms": latency,
                    "detail": f"HTTP 200" + (f", {n} models" if n is not None else "")}
        return {"status": "degraded", "latency_ms": latency, "detail": f"HTTP {r.status_code}"}
    except httpx.HTTPError as e:
        latency = round((time.monotonic() - start) * 1000)
        return {"status": "offline", "latency_ms": latency, "detail": f"{type(e).__name__}"}
