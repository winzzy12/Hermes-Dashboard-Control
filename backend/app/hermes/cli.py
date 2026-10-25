"""Hermes CLI invocation helpers.

Executes the hermes binary directly with an argument LIST (never a shell
string). Binary detection probes candidates with `--version` (rc=0 only) —
`which(hermes)` alone can be a broken shim.
"""
import os
import pathlib
import shutil
import subprocess
import threading

from .. import config

_bin_lock = threading.Lock()
_bin_cache: str | None = None


class HermesError(RuntimeError):
    """Raised when a hermes CLI invocation fails."""


def _candidates() -> list[str]:
    cands = []
    if config.HERMES_BIN:
        cands.append(config.HERMES_BIN)
    found = shutil.which("hermes")
    if found:
        cands.append(found)
    cands.append(str(pathlib.Path.home() / ".local" / "bin" / "hermes"))
    for home in pathlib.Path("/home").glob("*/.local/bin/hermes"):
        cands.append(str(home))
    seen, out = set(), []
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def hermes_bin() -> str:
    """Return a verified hermes binary path; raises HermesError if none works."""
    global _bin_cache
    with _bin_lock:
        if _bin_cache:
            return _bin_cache
        for cand in _candidates():
            if not os.path.isfile(cand) and not shutil.which(cand):
                continue
            try:
                r = subprocess.run([cand, "--version"], capture_output=True, text=True, timeout=30)
                if r.returncode == 0:
                    _bin_cache = cand
                    return cand
            except (OSError, subprocess.TimeoutExpired):
                continue
        raise HermesError(
            "hermes CLI not found or not executable. Install Hermes Agent or set HERMES_BIN."
        )


def run_cli(args: list[str], timeout: int = 120) -> tuple[int, str, str]:
    """Run `hermes <args>` with an argument list. Returns (rc, stdout, stderr)."""
    argv = [hermes_bin()] + list(args)
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        raise HermesError(f"hermes {' '.join(args[:2])} timed out after {timeout}s")
    except OSError as e:
        raise HermesError(f"failed to execute hermes: {e}")


def run_cli_checked(args: list[str], timeout: int = 120) -> str:
    """Run and return stdout; raise HermesError with a sanitized stderr tail on failure."""
    rc, out, err = run_cli(args, timeout=timeout)
    if rc != 0:
        tail = (err or out or "").strip().splitlines()[-3:]
        msg = " | ".join(tail)[:300] if tail else f"exit code {rc}"
        raise HermesError(f"hermes {' '.join(args[:2])} failed: {msg}")
    return out
