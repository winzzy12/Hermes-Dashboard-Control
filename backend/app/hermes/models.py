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
from pathlib import Path

import httpx
import yaml

from .. import config


class ModelsError(RuntimeError):
    pass


# Named custom models: aliases live in config.yaml `model.aliases.<name>` and
# each carries its own model, provider, base_url and credential pointer
# (key_env -> var in $HERMES_HOME/.env). Raw keys NEVER go into config.yaml.
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$")
_URL_RE = re.compile(r"https?://[^\s/][^\s]*")


def _env_path() -> Path:
    return config.HERMES_HOME / ".env"


def _write_env_var(name: str, value: str) -> None:
    """Set KEY=value in $HERMES_HOME/.env (replaces an existing line). Value is never logged."""
    p = _env_path()
    lines = p.read_text(errors="replace").splitlines() if p.exists() else []
    out = [l for l in lines if not l.strip().startswith(f"{name}=")]
    out.append(f"{name}={value}")
    p.write_text("\n".join(out) + "\n")
    try:
        os.chmod(p, 0o600)
    except OSError:
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


def _probe(base: str, key: str) -> dict:
    """GET {base}/models with the given key (server-side only)."""
    if not base:
        return {"status": "unknown", "latency_ms": 0, "detail": "no base_url configured"}
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


def test_provider() -> dict:
    """Connectivity test of the ACTIVE provider (key resolved server-side)."""
    mc = _load_config()
    return _probe((mc.get("base_url") or "").rstrip("/"), _resolve_secret(mc.get("api_key", "")))


# ------------------------------------------------------- named custom models

def _key_env_for(name: str) -> str:
    return f"HERMES_CUSTOM_{name.upper().replace('-', '_')}_API_KEY"


def _alias_entry(name: str) -> dict:
    mc = _load_config()
    a = (mc.get("aliases") or {}).get(name)
    if not isinstance(a, dict):
        raise ModelsError(f"custom model '{name}' not found")
    return a


def custom_models() -> list[dict]:
    """List named custom models (config.yaml model.aliases). Keys are never returned."""
    mc = _load_config()
    env = _env_map()
    active_default = mc.get("default") or ""
    active_base = (mc.get("base_url") or "").rstrip("/")
    out = []
    for name, a in (mc.get("aliases") or {}).items():
        if not isinstance(a, dict):
            continue
        key_env = a.get("key_env") or ""
        has_key = bool(env.get(key_env)) if key_env else bool(_resolve_secret(a.get("api_key") or ""))
        is_default = active_default == name or (
            active_default == (a.get("model") or "")
            and active_base == (a.get("base_url") or "").rstrip("/")
            and ((mc.get("provider") or "") == (a.get("provider") or "custom"))
        )
        out.append({
            "name": name,
            "model": a.get("model") or "",
            "provider": a.get("provider") or "custom",
            "base_url": a.get("base_url") or "",
            "key_env": key_env,
            "has_key": has_key,
            "is_default": is_default,
        })
    return out


def _set_active_route(model: str, base_url: str, key_env: str) -> None:
    """Point the agent's active model block at a custom route (CLI only, never hand edits)."""
    from . import cli
    cli.run_cli_checked(["config", "set", "model.default", model], timeout=60)
    cli.run_cli_checked(["config", "set", "model.provider", "custom"], timeout=60)
    cli.run_cli_checked(["config", "set", "model.base_url", base_url], timeout=60)
    if key_env:
        cli.run_cli_checked(["config", "set", "model.key_env", key_env], timeout=60)
    # Clear a stale inline key from a different route (Hermes' own persistence does the same).
    if _load_config().get("api_key"):
        cli.run_cli_checked(["config", "unset", "model.api_key"], timeout=60)


def add_custom_model(name: str, model: str, base_url: str, api_key: str, set_default: bool) -> dict:
    """Create or update a named custom model. api_key empty on update = keep existing key."""
    name = (name or "").strip()
    model = (model or "").strip()
    base = (base_url or "").strip().rstrip("/")
    if not _NAME_RE.fullmatch(name):
        raise ModelsError("name: 1-40 chars, letters/digits/'-'/'_', must start with a letter or digit")
    if not model:
        raise ModelsError("model is required")
    if not _URL_RE.fullmatch(base):
        raise ModelsError("base_url must be a valid http(s) URL")
    if api_key and len(api_key) > 2048:
        raise ModelsError("api_key looks too long")

    from . import cli
    prev = next((c for c in custom_models() if c["name"] == name), None)
    key_env = _key_env_for(name)
    if api_key:
        _write_env_var(key_env, api_key)
    elif not (prev and prev.get("key_env")):
        key_env = ""

    try:
        cli.run_cli_checked(["config", "set", f"model.aliases.{name}.model", model], timeout=60)
        cli.run_cli_checked(["config", "set", f"model.aliases.{name}.provider", "custom"], timeout=60)
        cli.run_cli_checked(["config", "set", f"model.aliases.{name}.base_url", base], timeout=60)
        if key_env:
            cli.run_cli_checked(["config", "set", f"model.aliases.{name}.key_env", key_env], timeout=60)
        if set_default:
            _set_active_route(model, base, key_env)
    except Exception:
        # Don't leave a half-written NEW alias behind; on update keep the previous one.
        if prev is None:
            try:
                cli.run_cli_checked(["config", "unset", f"model.aliases.{name}"], timeout=60)
            except Exception:
                pass
        raise
    return {"ok": True, "test": test_custom_model(name)}


def test_custom_model(name: str) -> dict:
    a = _alias_entry(name)
    base = (a.get("base_url") or "").rstrip("/")
    env = _env_map()
    key = env.get(a.get("key_env") or "", "") or _resolve_secret(a.get("api_key") or "")
    return _probe(base, key)


def activate_custom_model(name: str) -> None:
    a = _alias_entry(name)
    model = (a.get("model") or "").strip()
    base = (a.get("base_url") or "").strip().rstrip("/")
    if not model or not _URL_RE.fullmatch(base):
        raise ModelsError(f"custom model '{name}' has no usable model/base_url")
    _set_active_route(model, base, a.get("key_env") or "")


def delete_custom_model(name: str) -> None:
    if not any(c["name"] == name for c in custom_models()):
        raise ModelsError(f"custom model '{name}' not found")
    from . import cli
    cli.run_cli_checked(["config", "unset", f"model.aliases.{name}"], timeout=60)
