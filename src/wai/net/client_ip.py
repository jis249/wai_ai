"""Client IP extraction for rate limiting and audit (load-balancer aware)."""

from __future__ import annotations

import os

from starlette.requests import Request


def trust_proxy_headers() -> bool:
    """Honor X-Forwarded-For only when a trusted reverse proxy (IIS) is in front."""
    return os.environ.get("WAI_TRUST_PROXY", "").lower() in ("1", "true", "yes")


def client_ip(request: Request) -> str:
    """Return the client IP.

    ``X-Forwarded-For`` is used only when ``WAI_TRUST_PROXY`` is set so brute-force
    limits cannot be spoofed against a directly reachable backend.
    """
    if trust_proxy_headers():
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return ""
