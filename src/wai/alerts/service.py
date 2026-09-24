"""Start/stop helpers for the alert dispatcher and scheduler (used by the app lifespan)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

from wai.alerts import emit_alert, set_dispatcher
from wai.alerts.dispatcher import AlertDispatcher
from wai.alerts.scheduler import DEFAULT_INTERVAL, AlertScheduler
from wai.alerts.store import AlertStore


@dataclass
class Alerting:
    dispatcher: AlertDispatcher
    scheduler: AlertScheduler | None


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.lower() in ("1", "true", "yes", "on")


async def start_alerting(db: Any, encryption_key: bytes, *, log: logging.Logger | None = None) -> Alerting | None:
    """Start the dispatcher (and scheduled checks unless WAI_ALERTS_SCHEDULER=false).

    WAI_ALERTS_ENABLED=false disables alerting entirely (emit_alert stays a no-op).
    """
    logger = log or logging.getLogger("wai.alerts")
    if not _env_bool("WAI_ALERTS_ENABLED", True):
        logger.info("alerting disabled (WAI_ALERTS_ENABLED=false)")
        return None
    dispatcher = AlertDispatcher(AlertStore(db, encryption_key), log=logger)
    await dispatcher.start()
    set_dispatcher(dispatcher)
    scheduler: AlertScheduler | None = None
    if _env_bool("WAI_ALERTS_SCHEDULER", True):
        try:
            interval = float(os.environ.get("WAI_ALERTS_CHECK_INTERVAL_SECONDS", "") or DEFAULT_INTERVAL)
        except ValueError:
            interval = DEFAULT_INTERVAL
        scheduler = AlertScheduler(db, emit_alert, interval=interval, log=logger)
        await scheduler.start()
    return Alerting(dispatcher=dispatcher, scheduler=scheduler)


async def stop_alerting(alerting: Alerting | None) -> None:
    if alerting is None:
        return
    if alerting.scheduler is not None:
        await alerting.scheduler.stop()
    set_dispatcher(None)
    await alerting.dispatcher.stop()
