"""Alerting: ``emit_alert()`` queues events for a background dispatcher.

``emit_alert`` never raises and never blocks the request path. Until the dispatcher is
started (app lifespan) it is a no-op, so importing and calling it is always safe.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from uuid6 import uuid7

if TYPE_CHECKING:
    from wai.alerts.dispatcher import AlertDispatcher

_log = logging.getLogger("wai.alerts")
_dispatcher: "AlertDispatcher | None" = None


def set_dispatcher(dispatcher: "AlertDispatcher | None") -> None:
    global _dispatcher
    _dispatcher = dispatcher


def get_dispatcher() -> "AlertDispatcher | None":
    return _dispatcher


def emit_alert(
    kind: str,
    severity: str,
    title: str,
    message: str,
    org_id: str | None = None,
    data: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> None:
    """Queue an alert event for delivery. Returns immediately; never raises."""
    d = _dispatcher
    if d is None:
        return None
    try:
        from wai.alerts.models import AlertEvent

        event = AlertEvent.create(
            id=str(uuid7()),
            kind=kind,
            severity=severity,
            title=title,
            message=message,
            org_id=org_id,
            data=data,
            dedupe_key=dedupe_key,
        )
        d.submit(event)
    except Exception as exc:  # pragma: no cover - defensive
        _log.debug("emit_alert failed: %s", exc)
    return None


__all__ = ["emit_alert", "get_dispatcher", "set_dispatcher"]
