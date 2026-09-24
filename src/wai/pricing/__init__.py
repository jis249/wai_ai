"""Model catalog pricing sync from the LiteLLM community price list."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from wai.config.models import PricingSyncConfig
from wai.pricing.catalog import Catalog, CatalogEntry, CatalogError, CatalogFetcher, parse_catalog
from wai.pricing.matcher import ModelFacts, candidate_keys, match_model

logger = logging.getLogger("wai.pricing")

_fetcher: CatalogFetcher | None = None
_auto_task: asyncio.Task | None = None


def pricing_config(app: Any = None) -> PricingSyncConfig:
    cfg = getattr(getattr(app, "state", None), "config", None) if app is not None else None
    pc = getattr(cfg, "pricing", None)
    return pc if isinstance(pc, PricingSyncConfig) else PricingSyncConfig()


def get_fetcher(pc: PricingSyncConfig | None = None) -> CatalogFetcher:
    """Process-wide fetcher (keeps the last catalog + ETag in memory)."""
    global _fetcher
    pc = pc or PricingSyncConfig()
    if _fetcher is None:
        _fetcher = CatalogFetcher(
            pc.source_url, pc.local_path, timeout=pc.timeout_seconds, max_bytes=pc.max_bytes
        )
    else:
        _fetcher.configure(pc.source_url, pc.local_path, pc.timeout_seconds, pc.max_bytes)
    return _fetcher


def set_fetcher(fetcher: CatalogFetcher | None) -> None:
    """Test hook: replace the process-wide fetcher."""
    global _fetcher
    _fetcher = fetcher


def schedule_auto_sync(app: Any, handler_getter: Any, *, _attempt: int = 0) -> None:
    """Start the daily auto-sync once the app config is available, if ``pricing.auto_sync``.

    Called from route registration inside the app lifespan; the config is attached to
    ``app.state`` right after, so the check is deferred with ``call_soon``. Does nothing
    without a running loop or when auto-sync is off.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def _check() -> None:
        global _auto_task
        cfg = getattr(app.state, "config", None)
        if cfg is None:
            if _attempt < 5:
                loop.call_later(1.0, lambda: schedule_auto_sync(app, handler_getter, _attempt=_attempt + 1))
            return
        pc = pricing_config(app)
        if not pc.auto_sync or (_auto_task is not None and not _auto_task.done()):
            return
        from wai.pricing.service import auto_sync_loop

        try:
            h = handler_getter()
        except Exception:
            return
        _auto_task = loop.create_task(
            auto_sync_loop(h, get_fetcher(pc), pc.auto_sync_interval_hours, app=app),
            name="pricing-auto-sync",
        )
        logger.info("pricing auto-sync enabled (every %sh)", pc.auto_sync_interval_hours)

    loop.call_soon(_check)


async def stop_auto_sync() -> None:
    """Cancel the auto-sync task (if running) so shutdown doesn't wait on its DB lock."""
    global _auto_task
    task, _auto_task = _auto_task, None
    if task is None or task.done():
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass


__all__ = [
    "Catalog",
    "CatalogEntry",
    "CatalogError",
    "CatalogFetcher",
    "ModelFacts",
    "candidate_keys",
    "get_fetcher",
    "match_model",
    "parse_catalog",
    "pricing_config",
    "schedule_auto_sync",
    "set_fetcher",
]
