"""First-run setup status (public) and local Ollama/ops helpers."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request

from wai import __version__
from wai.api.admin.common import KeyInfo, ROLE_SYSTEM_ADMIN
from wai.api.admin.handler import get_handler, require_role

router = APIRouter()
_OLLAMA = os.environ.get("OLLAMA_HOST", "127.0.0.1:11434").replace("http://", "").replace("https://", "")


def _ollama_base() -> str:
    host = _OLLAMA if "://" not in _OLLAMA else _OLLAMA
    if host.startswith("http"):
        return host.rstrip("/")
    return f"http://{host}"


async def _probe_ollama() -> dict[str, Any]:
    base = _ollama_base()
    out: dict[str, Any] = {"ok": False, "base_url": base, "models": [], "loaded": []}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            tags = await client.get(f"{base}/api/tags")
            if tags.status_code == 200:
                data = tags.json()
                out["models"] = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
                out["ok"] = True
            ps = await client.get(f"{base}/api/ps")
            if ps.status_code == 200:
                pdata = ps.json()
                out["loaded"] = [m.get("name", "") for m in pdata.get("models", []) if m.get("name")]
    except Exception as exc:
        out["error"] = str(exc)
    return out


async def setup_status() -> dict[str, Any]:
    """Public checklist for first-run / local Windows install."""
    h = get_handler()
    database_ok = False
    has_users = False
    try:
        await h.db.fetchone("SELECT 1")
        database_ok = True
        row = await h.db.fetchone("SELECT COUNT(*) AS n FROM users")
        has_users = bool(row and int(row["n"]) > 0)
    except Exception:
        pass
    ollama = await _probe_ollama()
    return {
        "version": __version__,
        "database": {"ok": database_ok, "sslmode_note": "localhost DSN may use sslmode=disable"},
        "ollama": ollama,
        "has_users": has_users,
        "proxy_base_url": "http://localhost:8081/v1",
        "ready": database_ok and has_users,
    }


@router.get("/system/ollama")
async def system_ollama(_: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN))) -> dict[str, Any]:
    return await _probe_ollama()


@router.get("/system/ops")
async def system_ops(request: Request, _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN))) -> dict[str, Any]:
    root = Path(__file__).resolve().parents[4]
    log_path = root / "data" / "wai-backend.err.log"
    tail = ""
    if log_path.is_file():
        try:
            text = log_path.read_text(encoding="utf-8", errors="replace")
            tail = "\n".join(text.splitlines()[-40:])
        except OSError:
            tail = ""
    task_status = "unknown"
    try:
        import subprocess

        proc = subprocess.run(
            ["schtasks", "/query", "/tn", "WAI-Ensure-Running", "/fo", "LIST"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if proc.returncode == 0:
            task_status = "registered"
            if "Ready" in proc.stdout or "Running" in proc.stdout:
                task_status = "ready"
        else:
            task_status = "missing"
    except Exception:
        task_status = "unavailable"

    cfg = getattr(request.app.state, "config", None)
    dsn = getattr(getattr(cfg, "database", None), "dsn", "") if cfg else ""
    redacted_dsn = dsn
    if "@" in dsn:
        prefix, rest = dsn.split("@", 1)
        if ":" in prefix:
            scheme_user = prefix.rsplit(":", 1)[0]
            redacted_dsn = f"{scheme_user}:***@{rest}"

    return {
        "autostart_task": task_status,
        "backend_error_log_tail": tail,
        "config_path": os.environ.get("WAI_CONFIG", str(root / "wai.yaml")),
        "database_dsn_redacted": redacted_dsn,
        "backup_hint": "pg_dump -Fc -d wai -f wai-backup.dump  (keep .env.local and a redacted wai.yaml with the dump)",
        "trust_proxy": os.environ.get("WAI_TRUST_PROXY", ""),
        "dev_mode": os.environ.get("WAI_DEV", ""),
    }
