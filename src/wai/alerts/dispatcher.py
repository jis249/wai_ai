"""Background alert dispatcher: bounded queue, rule evaluation, fan-out to channels, event log."""

from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime
from typing import Any, Awaitable, Callable

import httpx

from wai.alerts.models import KIND_TEST, AlertChannel, AlertEvent, is_known_kind, parse_iso, utc_now
from wai.alerts.sender import TIMEOUT_SECONDS, deliver
from wai.alerts.store import AlertStore

log = logging.getLogger("wai.alerts")

DEFAULT_QUEUE_SIZE = 1000

Deliver = Callable[..., Awaitable[dict[str, Any]]]


class AlertDispatcher:
    """Consumes queued AlertEvents and delivers them per scope rules.

    Routing: an org event goes to that org's channels (per the org's rule for the kind);
    platform events (org_id None) and every critical event also go to the platform
    channels (per the platform rule); so do events of unknown kinds, with a default rule
    that accepts any severity. Each scope's rule must be enabled, the severity
    must be at least ``severity_min``, and a repeat of the same ``dedupe_key`` inside the
    rule's cooldown is suppressed. Events that fire in at least one scope are recorded
    in ``alert_events`` with per-channel delivery status (even when no channel matched).
    """

    def __init__(
        self,
        store: AlertStore,
        *,
        maxsize: int = DEFAULT_QUEUE_SIZE,
        deliver_fn: Deliver = deliver,
        clock: Callable[[], datetime] = utc_now,
        log: logging.Logger | None = None,
    ) -> None:
        self.store = store
        self._maxsize = max(1, int(maxsize))
        self._queue: asyncio.Queue[AlertEvent] | None = None
        self._deliver = deliver_fn
        self._clock = clock
        self._log = log or logging.getLogger("wai.alerts")
        self._task: asyncio.Task[None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: int | None = None
        self._client: httpx.AsyncClient | None = None
        self._last_fired: dict[tuple[str, str, str], datetime] = {}
        self._stopping = False
        self.dropped = 0
        self.processed = 0

    # --- lifecycle --------------------------------------------------------------------

    def _ensure_queue(self) -> asyncio.Queue[AlertEvent]:
        if self._queue is None:
            self._queue = asyncio.Queue(maxsize=self._maxsize)
        return self._queue

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._loop_thread = threading.get_ident()
        self._ensure_queue()
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False)
        self._task = asyncio.create_task(self._run(), name="alert-dispatcher")

    async def stop(self, drain_seconds: float = 3.0) -> None:
        self._stopping = True
        if self._task is not None:
            q = self._ensure_queue()
            try:
                await asyncio.wait_for(q.join(), timeout=drain_seconds)
            except (TimeoutError, asyncio.TimeoutError):
                pass
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # --- enqueue ----------------------------------------------------------------------

    def submit(self, event: AlertEvent) -> None:
        """Queue an event without blocking; drops the oldest queued event when full. Never raises."""
        try:
            if self._loop is not None and self._loop_thread is not None and threading.get_ident() != self._loop_thread:
                self._loop.call_soon_threadsafe(self._enqueue, event)
            else:
                self._enqueue(event)
        except Exception as exc:  # loop closed etc.
            self.dropped += 1
            self._log.debug("alert enqueue failed: %s", exc)

    def _enqueue(self, event: AlertEvent) -> None:
        q = self._ensure_queue()
        if q.full():
            try:
                q.get_nowait()
                q.task_done()
            except asyncio.QueueEmpty:
                pass
            self.dropped += 1
            if self.dropped == 1 or self.dropped % 100 == 0:
                self._log.warning("alert queue full; dropped %d event(s) so far", self.dropped)
        q.put_nowait(event)

    @property
    def queued(self) -> int:
        return self._queue.qsize() if self._queue is not None else 0

    # --- worker -----------------------------------------------------------------------

    async def _run(self) -> None:
        q = self._ensure_queue()
        while True:
            event = await q.get()
            try:
                await self.process(event)
            except Exception as exc:
                self._log.warning("alert processing failed (%s): %s", event.kind, type(exc).__name__)
            finally:
                q.task_done()

    async def drain(self) -> None:
        """Process everything currently queued (used by tests and shutdown paths)."""
        q = self._ensure_queue()
        while not q.empty():
            event = q.get_nowait()
            try:
                await self.process(event)
            finally:
                q.task_done()

    async def _in_cooldown(self, scope: str | None, event: AlertEvent, cooldown: int, now: datetime) -> bool:
        if not event.dedupe_key or cooldown <= 0:
            return False
        key = (scope or "", event.kind, event.dedupe_key)
        last = self._last_fired.get(key)
        if last is None:
            try:
                raw = await self.store.last_event_time(event.kind, event.dedupe_key, event.org_id)
            except Exception:
                raw = None
            last = parse_iso(raw or "")
        return last is not None and (now - last).total_seconds() < cooldown

    async def _send_all(self, channels: list[AlertChannel], event: AlertEvent) -> dict[str, Any]:
        results = await asyncio.gather(
            *(self._deliver(ch, event, client=self._client) for ch in channels), return_exceptions=True
        )
        out: dict[str, Any] = {}
        for ch, res in zip(channels, results):
            if isinstance(res, BaseException):
                res = {"ok": False, "status": 0, "attempts": 0, "error": type(res).__name__}
            out[ch.id] = {**res, "name": ch.name, "kind": ch.kind}
        return out

    async def process(self, event: AlertEvent) -> dict[str, Any] | None:
        """Evaluate rules, deliver, and record. Returns the delivery map, or None when suppressed."""
        self.processed += 1
        if event.kind == KIND_TEST:
            return None  # test events are sent directly via send_test()
        now = self._clock()
        scopes: list[str | None] = []
        if event.org_id:
            scopes.append(event.org_id)
        # Platform channels get platform events, every critical event, and every event of a
        # kind this version does not know (so new kinds never vanish silently).
        if event.org_id is None or event.severity == "critical" or not is_known_kind(event.kind):
            scopes.append(None)
        fired = False
        targets: dict[str, AlertChannel] = {}
        for scope in scopes:
            rule = await self.store.effective_rule(scope, event.kind)
            if not rule.allows(event.severity):
                continue
            if await self._in_cooldown(scope, event, rule.cooldown_seconds, now):
                continue
            fired = True
            if event.dedupe_key:
                self._last_fired[(scope or "", event.kind, event.dedupe_key)] = now
            channels = await self.store.enabled_channels(scope)
            if rule.channel_ids:
                wanted = set(rule.channel_ids)
                channels = [c for c in channels if c.id in wanted]
            for ch in channels:
                targets.setdefault(ch.id, ch)
        if not fired:
            return None
        if len(self._last_fired) > 10000:
            self._last_fired.clear()
        delivered = await self._send_all(list(targets.values()), event) if targets else {}
        await self.store.record_event(event, delivered)
        return delivered

    async def send_test(self, channel: AlertChannel, event: AlertEvent) -> dict[str, Any]:
        delivered = await self._send_all([channel], event)
        await self.store.record_event(event, delivered)
        return delivered[channel.id]
