"""Deliver one alert event to one channel: validate URL, POST with timeout and retries, never raise."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

import httpx

from wai.alerts.formatters import build_request
from wai.alerts.models import AlertChannel, AlertEvent
from wai.security.url import validate_http_url

log = logging.getLogger("wai.alerts")

TIMEOUT_SECONDS = 5.0
RETRIES = 2
BACKOFF_SECONDS = (0.5, 1.5)

UrlValidator = Callable[[str], Awaitable[None]]


def allow_private_urls() -> bool:
    return os.environ.get("WAI_ALERTS_ALLOW_PRIVATE_URLS", "").lower() in ("1", "true", "yes")


def check_url_syntax(url: str) -> str:
    """Cheap checks (no DNS): https, host present, no credentials in the URL."""
    u = (url or "").strip()
    parsed = urlparse(u)
    if parsed.scheme != "https":
        raise ValueError("url must use https")
    if not parsed.hostname:
        raise ValueError("url must include a host")
    if parsed.username or parsed.password:
        raise ValueError("url must not contain credentials")
    if len(u) > 2048:
        raise ValueError("url is too long")
    return u


async def validate_channel_url(url: str) -> None:
    """Full validation: syntax plus SSRF check with DNS resolution (in a worker thread)."""
    u = check_url_syntax(url)
    await asyncio.to_thread(validate_http_url, u, allow_private=allow_private_urls(), resolve=True)


def mask_url(url: str) -> str:
    """Host plus a masked path: never exposes tokens, signatures or query strings."""
    try:
        parsed = urlparse(url or "")
    except ValueError:
        return ""
    host = parsed.hostname or ""
    if not host:
        return ""
    segments = [s for s in (parsed.path or "").split("/") if s]
    first = segments[0] if segments else ""
    if first and len(first) > 24:
        first = ""
    path = f"/{first}" if first else ""
    return f"{host}{path}/****" if segments or parsed.query else host


async def deliver(
    channel: AlertChannel,
    event: AlertEvent,
    *,
    client: httpx.AsyncClient | None = None,
    validate: UrlValidator | None = None,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    retries: int = RETRIES,
) -> dict[str, Any]:
    """POST the event to the channel. Returns a delivery status dict; never raises."""
    started = time.monotonic()
    result: dict[str, Any] = {"ok": False, "status": 0, "attempts": 0, "error": ""}
    try:
        try:
            await (validate or validate_channel_url)(channel.url)
        except ValueError as exc:
            result["error"] = f"invalid url: {exc}"[:200]
            return result
        body, headers = build_request(channel.kind, event, secret=channel.secret, timestamp=int(time.time()))
        own_client = client is None
        c = client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False)
        try:
            for attempt in range(retries + 1):
                result["attempts"] = attempt + 1
                retryable = True
                try:
                    resp = await c.post(channel.url, content=body, headers=headers, timeout=TIMEOUT_SECONDS)
                    result["status"] = resp.status_code
                    if 200 <= resp.status_code < 300:
                        result["ok"] = True
                        result["error"] = ""
                        break
                    result["error"] = f"HTTP {resp.status_code}"
                    retryable = resp.status_code == 429 or resp.status_code >= 500
                except httpx.HTTPError as exc:
                    result["error"] = type(exc).__name__  # no URL/body echo
                if not retryable or attempt >= retries:
                    break
                await sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
        finally:
            if own_client:
                await c.aclose()
    except Exception as exc:  # never raise into the dispatcher
        log.warning("alert delivery failed for channel %s: %s", channel.id, type(exc).__name__)
        result["error"] = result["error"] or type(exc).__name__
    finally:
        result["ms"] = int((time.monotonic() - started) * 1000)
    return result
