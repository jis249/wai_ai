"""Per-deployment circuit breakers for the LLM proxy.

Each upstream target (model name + deployment name + base URL) gets a small state
machine:

    closed --(N consecutive failures | failure rate over window)--> open
    open   --(cooldown elapsed | healthy probe from the health checker)--> half_open
    half_open --(probe succeeds)--> closed
    half_open --(probe fails)--> open (cooldown grows exponentially, capped)

Failures are network errors, timeouts, 5xx and 429 responses. Other 4xx responses are
the caller's fault and never count. A 429 carrying ``Retry-After`` opens the circuit
right away for that long (capped), because the upstream has told us to back off.

State lives in memory only, guarded by a lock (safe from asyncio tasks and threads),
and the number of tracked circuits is bounded (least recently used ones are evicted).
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable

from wai.config.models import ReliabilityConfig

log = logging.getLogger("wai.proxy.circuit")

CLOSED = "closed"
OPEN = "open"
HALF_OPEN = "half_open"

_STATE_VALUE = {CLOSED: 0, HALF_OPEN: 1, OPEN: 2}
# A half-open probe that never reported back (e.g. a hung stream) stops blocking
# other probes after this long.
_PROBE_STALE_SECONDS = 120.0
_WINDOW_MAX_SAMPLES = 512
_SEP = "\x1f"

# Called as emit_alert(kind, severity, title, message, org_id=None, data=..., dedupe_key=...).
AlertFn = Callable[..., None]


def _default_emit_alert(*args: Any, **kwargs: Any) -> None:
    try:
        from wai.alerts import emit_alert
    except ImportError:
        return
    try:
        emit_alert(*args, **kwargs)
    except Exception:  # emit_alert must never break the request path
        log.debug("emit_alert failed", exc_info=True)


def is_failure_status(status_code: int) -> bool:
    """True for upstream statuses that count against a deployment's circuit."""
    return status_code == 429 or status_code >= 500


def parse_retry_after(value: str | None, *, now: float | None = None) -> float | None:
    """Parse a Retry-After header (delta seconds or HTTP date) into seconds, or None."""
    if not value:
        return None
    value = value.strip()
    try:
        seconds = float(value)
    except ValueError:
        try:
            when = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError):
            return None
        if when is None:
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        current = time.time() if now is None else now
        seconds = when.timestamp() - current
    if seconds != seconds or seconds < 0:  # NaN or in the past
        return 0.0 if seconds == seconds else None
    return seconds


def retry_after_from_headers(headers: Any) -> float | None:
    """Retry-After (seconds) from an httpx/Starlette headers mapping; also reads retry-after-ms."""
    if headers is None:
        return None
    try:
        ms = headers.get("retry-after-ms")
        if ms:
            return max(float(ms) / 1000.0, 0.0)
    except (TypeError, ValueError):
        pass
    try:
        return parse_retry_after(headers.get("retry-after"))
    except Exception:
        return None


def circuit_key(model_name: str, deployment_name: str, base_url: str) -> str:
    return _SEP.join((model_name or "", deployment_name or "", (base_url or "").rstrip("/")))


def public_id(key: str) -> str:
    """Stable opaque id for a circuit (no URLs leak to non-admin callers)."""
    return "dep_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


@dataclass
class _Circuit:
    key: str
    model: str
    deployment: str
    base_url: str
    state: str = CLOSED
    consecutive_failures: int = 0
    trips: int = 0
    opened_at: float = 0.0
    cooldown_until: float = 0.0
    last_failure_at: float = 0.0
    last_error: str = ""
    probe_inflight: bool = False
    probe_started: float = 0.0
    inflight: int = 0
    window: deque = field(default_factory=lambda: deque(maxlen=_WINDOW_MAX_SAMPLES))


class CircuitRegistry:
    """Thread/async-safe store of per-deployment circuit breakers."""

    def __init__(
        self,
        settings: ReliabilityConfig | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
        alert: AlertFn | None = None,
    ) -> None:
        self.settings = settings or ReliabilityConfig()
        self._clock = clock
        self._wall = wall_clock
        self._alert = alert or _default_emit_alert
        self._lock = threading.Lock()
        self._circuits: OrderedDict[str, _Circuit] = OrderedDict()

    # -- configuration --------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return bool(self.settings.circuit_enabled)

    def configure(self, settings: ReliabilityConfig) -> None:
        with self._lock:
            self.settings = settings

    # -- lookups ---------------------------------------------------------------

    def _get(self, key: str, model: str = "", deployment: str = "", base_url: str = "") -> _Circuit:
        c = self._circuits.get(key)
        if c is None:
            if not model:
                model, deployment, base_url = (key.split(_SEP) + ["", "", ""])[:3]
            c = _Circuit(key=key, model=model, deployment=deployment, base_url=base_url)
            self._circuits[key] = c
            self._evict()
        else:
            self._circuits.move_to_end(key)
        return c

    def _evict(self) -> None:
        limit = max(int(self.settings.circuit_max_entries or 0), 16)
        while len(self._circuits) > limit:
            victim = next(
                (k for k, c in self._circuits.items() if c.state == CLOSED and c.inflight == 0),
                next(iter(self._circuits)),
            )
            evicted = self._circuits.pop(victim)
            _metrics_forget(evicted)

    def _effective_state(self, c: _Circuit, now: float) -> str:
        if c.state == OPEN and now >= c.cooldown_until:
            return HALF_OPEN
        return c.state

    def state(self, key: str) -> str:
        with self._lock:
            c = self._circuits.get(key)
            if c is None:
                return CLOSED
            return self._effective_state(c, self._clock())

    def allows(self, key: str) -> bool:
        """Would a request to this target be admitted right now? (no state change)"""
        if not self.enabled:
            return True
        with self._lock:
            c = self._circuits.get(key)
            if c is None:
                return True
            now = self._clock()
            st = self._effective_state(c, now)
            if st == CLOSED:
                return True
            if st == HALF_OPEN:
                return not self._probe_busy(c, now)
            return False

    def last_failure_at(self, key: str) -> float:
        with self._lock:
            c = self._circuits.get(key)
            return c.last_failure_at if c is not None else 0.0

    def _probe_busy(self, c: _Circuit, now: float) -> bool:
        if c.state != HALF_OPEN or not c.probe_inflight:
            return False
        return (now - c.probe_started) < _PROBE_STALE_SECONDS

    # -- request lifecycle -------------------------------------------------------

    def acquire(self, key: str, *, model: str = "", deployment: str = "", base_url: str = "") -> str:
        """Admit a request. Returns "normal", "probe" (half-open trial) or "forced"
        (circuit open but no alternative was available). Also counts inflight."""
        with self._lock:
            c = self._get(key, model, deployment, base_url)
            c.inflight += 1
            if not self.enabled:
                return "normal"
            now = self._clock()
            if c.state == OPEN and now >= c.cooldown_until:
                c.state = HALF_OPEN
                c.probe_inflight = False
                _metrics_state(c)
            if c.state == CLOSED:
                return "normal"
            if c.state == HALF_OPEN and not self._probe_busy(c, now):
                c.probe_inflight = True
                c.probe_started = now
                return "probe"
            return "forced"

    def release(self, key: str, ticket: str) -> None:
        """Request finished without a circuit-relevant outcome (e.g. cache hit, 4xx)."""
        with self._lock:
            c = self._circuits.get(key)
            if c is None:
                return
            c.inflight = max(0, c.inflight - 1)
            if ticket == "probe" and c.state == HALF_OPEN:
                c.probe_inflight = False

    def record_success(self, key: str, ticket: str = "") -> None:
        events: list[tuple] = []
        with self._lock:
            c = self._get(key)
            if ticket:
                c.inflight = max(0, c.inflight - 1)
            now = self._clock()
            c.window.append((now, True))
            c.consecutive_failures = 0
            if c.state != CLOSED:
                prev = c.state
                c.state = CLOSED
                c.trips = 0
                c.probe_inflight = False
                c.cooldown_until = 0.0
                _metrics_state(c, transition=CLOSED)
                events.append(("closed", c, prev))
        self._emit(events)

    def record_failure(
        self,
        key: str,
        ticket: str = "",
        *,
        retry_after: float | None = None,
        reason: str = "",
    ) -> None:
        events: list[tuple] = []
        with self._lock:
            c = self._get(key)
            if ticket:
                c.inflight = max(0, c.inflight - 1)
            now = self._clock()
            c.window.append((now, False))
            c.consecutive_failures += 1
            c.last_failure_at = now
            if reason:
                c.last_error = reason[:200]
            if not self.enabled:
                return
            s = self.settings
            should_trip = False
            if c.state == HALF_OPEN:
                should_trip = True
            elif c.state == CLOSED:
                if retry_after is not None and retry_after > 0 and s.circuit_open_on_retry_after:
                    should_trip = True
                elif c.consecutive_failures >= max(int(s.circuit_failure_threshold or 0), 1):
                    should_trip = True
                elif self._rate_tripped(c, now):
                    should_trip = True
            elif c.state == OPEN and retry_after:
                # A forced request failed again: honour the newer Retry-After if longer.
                c.cooldown_until = max(c.cooldown_until, now + min(retry_after, s.circuit_max_cooldown_seconds))
            if should_trip:
                prev = c.state
                self._trip(c, now, retry_after)
                events.append(("opened", c, prev))
        self._emit(events)

    def _rate_tripped(self, c: _Circuit, now: float) -> bool:
        s = self.settings
        threshold = float(s.circuit_failure_rate_threshold or 0)
        if threshold <= 0:
            return False
        horizon = now - max(float(s.circuit_window_seconds or 0), 1.0)
        samples = [ok for ts, ok in c.window if ts >= horizon]
        if len(samples) < max(int(s.circuit_min_requests or 0), 1):
            return False
        failures = sum(1 for ok in samples if not ok)
        return failures / len(samples) >= threshold

    def _trip(self, c: _Circuit, now: float, retry_after: float | None) -> None:
        s = self.settings
        cap = max(float(s.circuit_max_cooldown_seconds or 0), 1.0)
        base = max(float(s.circuit_cooldown_seconds or 0), 0.1)
        c.trips += 1
        if retry_after is not None and retry_after > 0:
            cooldown = min(retry_after, cap)
        else:
            cooldown = min(base * (2 ** min(c.trips - 1, 16)), cap)
        c.state = OPEN
        c.opened_at = now
        c.cooldown_until = now + cooldown
        c.probe_inflight = False
        _metrics_state(c, transition=OPEN)

    # -- health checker feed ---------------------------------------------------

    def report_health(self, model_name: str, base_url: str, healthy: bool, *, reason: str = "") -> None:
        """Feed a health-probe result for every circuit of ``model_name`` at ``base_url``.

        Unhealthy opens the circuit (normal cooldown); healthy moves an open circuit to
        half-open early so the next request probes it instead of waiting out the cooldown.
        """
        if not self.enabled:
            return
        target = (base_url or "").rstrip("/")
        events: list[tuple] = []
        with self._lock:
            matches = [
                c for c in self._circuits.values()
                if c.model == model_name and (not target or c.base_url == target)
            ]
            if not matches and not healthy:
                matches = [self._get(circuit_key(model_name, "", target), model_name, "", target)]
            now = self._clock()
            for c in matches:
                if healthy:
                    if c.state == OPEN:
                        c.state = HALF_OPEN
                        c.probe_inflight = False
                        _metrics_state(c)
                    continue
                c.last_failure_at = now
                if reason:
                    c.last_error = reason[:200]
                if c.state in (CLOSED, HALF_OPEN):
                    prev = c.state
                    self._trip(c, now, None)
                    events.append(("opened", c, prev))
        self._emit(events)

    # -- introspection -----------------------------------------------------------

    def snapshot(self, model_name: str | None = None) -> list[dict[str, Any]]:
        """JSON-safe circuit states (the ``deployments`` list of /models/health)."""
        with self._lock:
            now = self._clock()
            offset = self._wall() - now
            out: list[dict[str, Any]] = []
            for c in self._circuits.values():
                if model_name is not None and c.model != model_name:
                    continue
                st = self._effective_state(c, now)
                cooldown = ""
                if c.state == OPEN and c.cooldown_until > now:
                    cooldown = _iso(c.cooldown_until + offset)
                out.append(
                    {
                        "id": public_id(c.key),
                        "name": c.deployment or "default",
                        "model": c.model,
                        "circuit": st,
                        "consecutive_failures": c.consecutive_failures,
                        "cooldown_until": cooldown,
                        "inflight": c.inflight,
                    }
                )
            return out

    def reset(self) -> None:
        with self._lock:
            for c in self._circuits.values():
                _metrics_forget(c)
            self._circuits.clear()

    # -- alerts -------------------------------------------------------------------

    def _emit(self, events: list[tuple]) -> None:
        for kind, c, prev in events:
            label = f"{c.model}/{c.deployment}" if c.deployment else c.model
            data = {
                "model": c.model,
                "deployment": c.deployment or "default",
                "previous": prev,
                "consecutive_failures": c.consecutive_failures,
            }
            if kind == "opened":
                cooldown = max(c.cooldown_until - c.opened_at, 0.0)
                data["cooldown_seconds"] = round(cooldown, 1)
                log.warning("circuit opened for %s (cooldown %.1fs): %s", label, cooldown, c.last_error)
                self._safe_alert(
                    "deployment.circuit",
                    "warning",
                    f"Circuit open: {label}",
                    f"Traffic to {label} is paused for {cooldown:.0f}s after upstream failures"
                    + (f" ({c.last_error})" if c.last_error else "")
                    + ".",
                    data=data,
                    dedupe_key=f"deployment.circuit:{c.key}",
                )
            else:
                log.info("circuit closed for %s", label)
                self._safe_alert(
                    "deployment.circuit",
                    "info",
                    f"Circuit recovered: {label}",
                    f"{label} is serving requests again.",
                    data=data,
                    dedupe_key=f"deployment.circuit:{c.key}:closed",
                )

    def _safe_alert(self, *args: Any, **kwargs: Any) -> None:
        try:
            self._alert(*args, **kwargs)
        except Exception:
            log.debug("circuit alert failed", exc_info=True)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _metrics_state(c: _Circuit, *, transition: str = "") -> None:
    try:
        from wai.metrics import observe_circuit_state

        observe_circuit_state(c.model, c.deployment or "default", _STATE_VALUE.get(c.state, 0), transition)
    except Exception:
        pass


def _metrics_forget(c: _Circuit) -> None:
    try:
        from wai.metrics import forget_circuit

        forget_circuit(c.model, c.deployment or "default")
    except Exception:
        pass


# -- process-wide active registry ---------------------------------------------------
# The ProxyHandler owns its registry and publishes it here so the admin API
# (/models/health) and the health checker can read and feed it.

_active: CircuitRegistry | None = None
_active_lock = threading.Lock()


def set_active_registry(registry: CircuitRegistry | None) -> None:
    global _active
    with _active_lock:
        _active = registry


def get_active_registry() -> CircuitRegistry | None:
    return _active


__all__ = [
    "CLOSED",
    "HALF_OPEN",
    "OPEN",
    "CircuitRegistry",
    "circuit_key",
    "get_active_registry",
    "is_failure_status",
    "parse_retry_after",
    "public_id",
    "retry_after_from_headers",
    "set_active_registry",
]
