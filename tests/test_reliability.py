"""Reliability: circuit breakers, circuit-aware selection, retry backoff, health feed, alerts."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from wai.config.loader import _from_dict
from wai.config.models import ReliabilityConfig
from wai.health.model_checker import ModelHealthChecker
from wai.proxy import circuit as circuit_mod
from wai.proxy.circuit import (
    CLOSED,
    HALF_OPEN,
    OPEN,
    CircuitRegistry,
    circuit_key,
    parse_retry_after,
)
from wai.proxy.handler import ProxyHandler
from wai.proxy.registry import Deployment, Model, Registry
from wai.proxy.routing import select_deployment


class FakeClock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class AlertSink:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, kind, severity, title, message, org_id=None, data=None, dedupe_key=None):
        self.calls.append(
            {"kind": kind, "severity": severity, "title": title, "data": data, "dedupe_key": dedupe_key}
        )


def _reg(clock=None, alerts=None, **overrides) -> CircuitRegistry:
    return CircuitRegistry(
        ReliabilityConfig(**overrides),
        clock=clock or FakeClock(),
        wall_clock=lambda: 1_700_000_000.0,
        alert=alerts or AlertSink(),
    )


K = circuit_key("m", "d0", "http://d0")


# --- state machine ----------------------------------------------------------------


def test_opens_after_consecutive_failures_and_recovers_via_probe():
    clock, alerts = FakeClock(), AlertSink()
    reg = _reg(clock, alerts)
    for i in range(4):
        t = reg.acquire(K)
        reg.record_failure(K, t, reason="boom")
        assert reg.state(K) == CLOSED
    t = reg.acquire(K)
    reg.record_failure(K, t)
    assert reg.state(K) == OPEN
    assert not reg.allows(K)
    assert alerts.calls[-1]["kind"] == "deployment.circuit"
    assert alerts.calls[-1]["severity"] == "warning"
    assert alerts.calls[-1]["dedupe_key"].startswith("deployment.circuit:")

    clock.advance(29.9)
    assert not reg.allows(K)
    clock.advance(0.2)
    assert reg.state(K) == HALF_OPEN
    assert reg.allows(K)
    assert reg.acquire(K) == "probe"
    # only one probe at a time
    assert not reg.allows(K)
    assert reg.acquire(K) == "forced"
    reg.release(K, "forced")
    reg.record_success(K, "probe")
    assert reg.state(K) == CLOSED
    assert alerts.calls[-1]["severity"] == "info"
    assert reg.snapshot("m")[0]["consecutive_failures"] == 0
    assert reg.snapshot("m")[0]["inflight"] == 0


def test_success_resets_consecutive_count():
    reg = _reg()
    for _ in range(4):
        reg.record_failure(K)
    reg.record_success(K)
    for _ in range(4):
        reg.record_failure(K)
    assert reg.state(K) == CLOSED


def test_half_open_failure_reopens_with_exponential_cooldown():
    clock = FakeClock()
    reg = _reg(clock, circuit_failure_threshold=1, circuit_cooldown_seconds=30, circuit_max_cooldown_seconds=100)
    reg.record_failure(K)
    assert reg.state(K) == OPEN
    clock.advance(30)
    assert reg.acquire(K) == "probe"
    reg.record_failure(K, "probe")
    assert reg.state(K) == OPEN
    clock.advance(59)
    assert reg.state(K) == OPEN  # second trip: 60s
    clock.advance(1)
    assert reg.acquire(K) == "probe"
    reg.record_failure(K, "probe")
    clock.advance(99)
    assert reg.state(K) == OPEN  # third trip: 120s capped to 100s
    clock.advance(1)
    assert reg.state(K) == HALF_OPEN


def test_abandoned_probe_frees_the_slot():
    clock = FakeClock()
    reg = _reg(clock, circuit_failure_threshold=1)
    reg.record_failure(K)
    clock.advance(31)
    t = reg.acquire(K)
    assert t == "probe"
    reg.release(K, t)  # e.g. a 400 from the client: not an outcome
    assert reg.state(K) == HALF_OPEN
    assert reg.allows(K)


def test_retry_after_429_opens_immediately_for_that_long():
    clock = FakeClock()
    reg = _reg(clock)
    reg.record_failure(K, retry_after=7.0, reason="upstream status 429")
    assert reg.state(K) == OPEN
    snap = reg.snapshot("m")[0]
    assert snap["circuit"] == OPEN and snap["cooldown_until"]
    clock.advance(7)
    assert reg.state(K) == HALF_OPEN


def test_failure_rate_window_trips():
    clock = FakeClock()
    reg = _reg(
        clock,
        circuit_failure_threshold=100,
        circuit_failure_rate_threshold=0.5,
        circuit_min_requests=10,
        circuit_window_seconds=60,
    )
    for i in range(10):
        clock.advance(1)
        if i % 2:
            reg.record_failure(K)
        else:
            reg.record_success(K)
    assert reg.state(K) == OPEN


def test_disabled_never_opens():
    reg = _reg(circuit_enabled=False)
    for _ in range(20):
        reg.record_failure(K)
    assert reg.allows(K)
    assert reg.acquire(K) == "normal"


def test_bounded_memory():
    reg = _reg(circuit_max_entries=16)
    for i in range(100):
        reg.record_success(circuit_key("m", f"d{i}", f"http://d{i}"))
    assert len(reg.snapshot()) == 16


def test_parse_retry_after():
    assert parse_retry_after("3") == 3.0
    assert parse_retry_after("") is None
    assert parse_retry_after("garbage") is None
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT", now=1445412470.0) == pytest.approx(10.0)


def test_alert_errors_are_swallowed():
    def boom(*a, **k):
        raise RuntimeError("x")

    reg = CircuitRegistry(ReliabilityConfig(circuit_failure_threshold=1), alert=boom)
    reg.record_failure(K)
    assert reg.state(K) == OPEN


# --- selection ------------------------------------------------------------------------


def _model(strategy="priority", n=3, **kw) -> Model:
    return Model(
        name="m",
        strategy=strategy,
        deployments=[Deployment(name=f"d{i}", base_url=f"http://d{i}", priority=i, weight=1) for i in range(n)],
        **kw,
    )


def _allow(reg, model):
    return lambda d: reg.allows(circuit_key(model.name, d.name, d.base_url))


def _lf(reg, model):
    return lambda d: reg.last_failure_at(circuit_key(model.name, d.name, d.base_url))


def test_selection_skips_open_circuits_all_strategies():
    clock = FakeClock()
    reg = _reg(clock, circuit_failure_threshold=1)
    reg.record_failure(circuit_key("m", "d0", "http://d0"))
    for strategy in ("priority", "least-busy", "round-robin", "weighted", ""):
        m = _model(strategy)
        for _ in range(6):
            dep = select_deployment(m, allow=_allow(reg, m), last_failure=_lf(reg, m), rr_counters={})
            assert dep.name != "d0", strategy


def test_selection_all_open_picks_least_recently_failed():
    clock = FakeClock()
    reg = _reg(clock, circuit_failure_threshold=1)
    m = _model()
    for name in ("d1", "d0", "d2"):
        clock.advance(1)
        reg.record_failure(circuit_key("m", name, f"http://{name}"))
    dep = select_deployment(m, allow=_allow(reg, m), last_failure=_lf(reg, m))
    assert dep.name == "d1"


def test_selection_respects_exclude_then_circuits():
    reg = _reg(circuit_failure_threshold=1)
    m = _model()
    reg.record_failure(circuit_key("m", "d1", "http://d1"))
    dep = select_deployment(m, exclude={"http://d0"}, allow=_allow(reg, m), last_failure=_lf(reg, m))
    assert dep.name == "d2"


# --- handler retry/backoff -----------------------------------------------------------------


def _request(body: bytes = b'{"model":"m"}'):
    async def _body() -> bytes:
        return body

    return SimpleNamespace(body=_body, state=SimpleNamespace(request_id="rid"), headers={}, method="POST")


def _handler(model: Model, **cfg) -> tuple[ProxyHandler, list[float], FakeClock]:
    registry = Registry()
    registry.add_model(model)
    clock = FakeClock()
    circuits = CircuitRegistry(ReliabilityConfig(**cfg), clock=clock, alert=AlertSink())
    h = ProxyHandler(registry, circuits=circuits)
    sleeps: list[float] = []

    async def fake_sleep(s: float) -> None:
        sleeps.append(s)
        clock.advance(s)

    h._sleep = fake_sleep  # type: ignore[assignment]
    h._clock = clock
    return h, sleeps, clock


def _status_error(status: int, headers: dict | None = None) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "http://x")
    return httpx.HTTPStatusError("s", request=req, response=httpx.Response(status, headers=headers, request=req))


def _run(h: ProxyHandler, body: bytes = b'{"model":"m"}'):
    async def run():
        try:
            return await h.handle(_request(body), "chat/completions")
        finally:
            await h.close()

    return asyncio.run(run())


def test_backoff_between_attempts_with_jitter():
    h, sleeps, _ = _handler(_model(max_retries=3))
    tried: list[str] = []

    async def fwd(request, *, model, **kw):
        tried.append(model.base_url)
        if len(tried) < 4:
            raise httpx.ConnectError("boom")
        return "ok"

    h._forward = fwd  # type: ignore[assignment]
    assert _run(h) == "ok"
    assert tried[:3] == ["http://d0", "http://d1", "http://d2"]
    assert len(sleeps) == 3
    assert 0.05 <= sleeps[0] <= 0.1
    assert 0.1 <= sleeps[1] <= 0.2
    assert 0.2 <= sleeps[2] <= 0.4
    assert all(s <= 2.0 for s in sleeps)


def test_retry_after_honoured_when_no_alternative():
    h, sleeps, _ = _handler(Model(name="m", base_url="http://only", max_retries=1))
    calls = []

    async def fwd(request, *, model, **kw):
        calls.append(1)
        if len(calls) == 1:
            raise _status_error(429, {"retry-after": "3"})
        return "ok"

    h._forward = fwd  # type: ignore[assignment]
    assert _run(h) == "ok"
    assert sleeps == [3.0]
    # the 429 opened the circuit; the forced retry succeeded and closed it
    assert h.circuits.state(circuit_key("m", "", "http://only")) == CLOSED


def test_long_retry_after_moves_to_fallback_model():
    registry = Registry()
    registry.add_model(Model(name="m", base_url="http://a", max_retries=3, fallback_model_name="fb"))
    registry.add_model(Model(name="fb", base_url="http://b"))
    h = ProxyHandler(registry, circuits=CircuitRegistry(alert=AlertSink()))
    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)

    h._sleep = fake_sleep  # type: ignore[assignment]
    tried = []

    async def fwd(request, *, model, **kw):
        tried.append(model.name)
        if model.name == "m":
            raise _status_error(429, {"retry-after": "60"})
        return "ok"

    h._forward = fwd  # type: ignore[assignment]
    assert _run(h) == "ok"
    assert tried == ["m", "fb"]
    assert sleeps == []


def test_retry_after_ignored_when_another_deployment_exists():
    h, sleeps, _ = _handler(_model(n=2, max_retries=1))
    tried = []

    async def fwd(request, *, model, **kw):
        tried.append(model.base_url)
        if model.base_url == "http://d0":
            raise _status_error(429, {"retry-after": "8"})
        return "ok"

    h._forward = fwd  # type: ignore[assignment]
    assert _run(h) == "ok"
    assert tried == ["http://d0", "http://d1"]
    assert sleeps and sleeps[0] < 1.0


def test_retry_budget_bounds_attempts():
    from datetime import timedelta

    h, sleeps, clock = _handler(
        Model(name="m", base_url="http://only", max_retries=10, timeout=timedelta(seconds=1)),
        retry_backoff_base_ms=400,
        retry_backoff_max_ms=2000,
    )
    calls = []

    async def fwd(request, *, model, **kw):
        calls.append(1)
        clock.advance(0.1)
        raise httpx.ConnectTimeout("slow")

    h._forward = fwd  # type: ignore[assignment]
    with pytest.raises(HTTPException) as exc:
        _run(h)
    assert exc.value.status_code == 502
    assert len(calls) < 11
    assert sum(sleeps) < 1.0


def test_handler_records_outcomes_and_skips_open_deployment():
    h, _, _ = _handler(_model(n=2, max_retries=0), circuit_failure_threshold=2)
    tried = []

    async def fwd(request, *, model, **kw):
        tried.append(model.base_url)
        if model.base_url == "http://d0":
            raise httpx.ConnectError("down")
        return SimpleNamespace(status_code=200, headers={})

    h._forward = fwd  # type: ignore[assignment]

    async def run():
        out = []
        for _ in range(4):
            try:
                out.append(await h.handle(_request(), "chat/completions"))
            except HTTPException as exc:
                out.append(exc.status_code)
        await h.close()
        return out

    results = asyncio.run(run())
    assert results[:2] == [502, 502]
    # circuit for d0 is now open -> traffic goes to d1
    assert tried[2:] == ["http://d1", "http://d1"]
    snap = {d["name"]: d for d in h.circuits.snapshot("m")}
    assert snap["d0"]["circuit"] == OPEN and snap["d0"]["consecutive_failures"] == 2
    assert snap["d1"]["circuit"] == CLOSED and snap["d1"]["inflight"] == 0


def test_4xx_response_is_not_a_failure():
    h, _, _ = _handler(Model(name="m", base_url="http://x"), circuit_failure_threshold=1)

    async def fwd(request, *, model, **kw):
        return SimpleNamespace(status_code=400, headers={})

    h._forward = fwd  # type: ignore[assignment]
    _run(h)
    assert h.circuits.state(circuit_key("m", "", "http://x")) == CLOSED


def test_returned_5xx_counts_as_failure():
    h, _, _ = _handler(Model(name="m", base_url="http://x"), circuit_failure_threshold=1)

    async def fwd(request, *, model, **kw):
        return SimpleNamespace(status_code=501, headers={})

    h._forward = fwd  # type: ignore[assignment]
    _run(h)
    assert h.circuits.state(circuit_key("m", "", "http://x")) == OPEN


def test_fallback_chain_skips_model_with_all_circuits_open():
    registry = Registry()
    registry.add_model(Model(name="m", base_url="http://a", fallback_model_name="fb"))
    registry.add_model(Model(name="fb", base_url="http://b"))
    circuits = CircuitRegistry(ReliabilityConfig(circuit_failure_threshold=1), alert=AlertSink())
    circuits.record_failure(circuit_key("m", "", "http://a"))
    h = ProxyHandler(registry, circuits=circuits)
    tried = []

    async def fwd(request, *, model, **kw):
        tried.append(model.name)
        return "ok"

    h._forward = fwd  # type: ignore[assignment]
    assert _run(h) == "ok"
    assert tried == ["fb"]


def test_single_open_target_still_tried():
    registry = Registry()
    registry.add_model(Model(name="m", base_url="http://a"))
    circuits = CircuitRegistry(ReliabilityConfig(circuit_failure_threshold=1), alert=AlertSink())
    circuits.record_failure(circuit_key("m", "", "http://a"))
    h = ProxyHandler(registry, circuits=circuits)

    async def fwd(request, *, model, **kw):
        return SimpleNamespace(status_code=200, headers={})

    h._forward = fwd  # type: ignore[assignment]
    _run(h)
    assert circuits.state(circuit_key("m", "", "http://a")) == CLOSED


def test_handler_publishes_active_registry_and_wires_health_checker():
    hc = SimpleNamespace(is_unhealthy=lambda name: False)
    h = ProxyHandler(Registry(), health_checker=hc)
    assert circuit_mod.get_active_registry() is h.circuits
    assert hc.circuits is h.circuits
    asyncio.run(h.close())


# --- health checker feed + alerts ---------------------------------------------------------


class _FakeDB:
    def __init__(self, rows):
        self.rows = rows

    async def fetchall(self, *a, **k):
        return self.rows


def test_health_checker_feeds_circuits_and_alerts(monkeypatch):
    sent: list[tuple] = []
    import wai.alerts as alerts_pkg

    monkeypatch.setattr(alerts_pkg, "emit_alert", lambda *a, **k: sent.append((a, k)))

    clock = FakeClock()
    circuits = CircuitRegistry(ReliabilityConfig(), clock=clock, alert=AlertSink())
    key = circuit_key("m", "", "http://x")
    circuits.record_success(key)

    row = {"id": "1", "name": "m", "provider": "openai", "base_url": "http://x/", "api_key_encrypted": None}
    checker = ModelHealthChecker(_FakeDB([row]), b"k" * 32)
    checker.circuits = circuits
    results = iter(["healthy", "unhealthy", "healthy"])

    async def probe(item):
        status = next(results)
        return checker._build_result(
            item["name"],
            status=status,
            latency_ms=1,
            health_ok=status == "healthy",
            models_ok=True,
            functional_ok=True,
            last_error="" if status == "healthy" else "upstream returned 503",
        )

    checker._probe_model = probe  # type: ignore[assignment]

    asyncio.run(checker.probe_all())
    assert circuits.state(key) == CLOSED
    assert sent == []  # first observation: no transition alert

    asyncio.run(checker.probe_all())
    assert circuits.state(key) == OPEN
    assert sent[-1][0][0] == "model.health" and sent[-1][0][1] == "warning"
    assert sent[-1][1]["dedupe_key"] == "model.health:m"

    asyncio.run(checker.probe_all())
    # healthy probe moves the open circuit to half-open early (no need to wait 30s)
    assert circuits.state(key) == HALF_OPEN
    assert sent[-1][0][1] == "info"


def test_health_unhealthy_creates_circuit_for_untracked_model():
    circuits = CircuitRegistry(alert=AlertSink())
    circuits.report_health("m", "http://x", False, reason="down")
    assert circuits.state(circuit_key("m", "", "http://x")) == OPEN


# --- /models/health contract -----------------------------------------------------------------


def test_models_health_items_gain_deployments():
    from wai.api.admin.models import _with_circuits

    circuits = CircuitRegistry(ReliabilityConfig(circuit_failure_threshold=1), alert=AlertSink())
    circuits.record_failure(circuit_key("m", "east", "http://east"))
    circuits.record_success(circuit_key("m", "west", "http://west"))
    circuit_mod.set_active_registry(circuits)
    try:
        items = _with_circuits([{"name": "m", "status": "healthy"}, {"name": "other"}])
    finally:
        circuit_mod.set_active_registry(None)
    deps = {d["name"]: d for d in items[0]["deployments"]}
    assert set(deps) == {"east", "west"}
    assert set(deps["east"]) == {"id", "name", "circuit", "consecutive_failures", "cooldown_until", "inflight"}
    assert deps["east"]["circuit"] == "open" and deps["east"]["cooldown_until"].endswith("+00:00")
    assert deps["west"]["circuit"] == "closed" and deps["west"]["cooldown_until"] == ""
    assert "http" not in deps["east"]["id"]
    assert items[1]["deployments"] == []


# --- config ----------------------------------------------------------------------------------


def test_reliability_config_defaults_and_overrides():
    cfg = _from_dict({})
    assert cfg.reliability.circuit_failure_threshold == 5
    assert cfg.reliability.circuit_cooldown_seconds == 30.0
    cfg = _from_dict(
        {"reliability": {"circuit_failure_threshold": "3", "circuit_enabled": False, "retry_after_max_seconds": "bad"}}
    )
    assert cfg.reliability.circuit_failure_threshold == 3
    assert cfg.reliability.circuit_enabled is False
    assert cfg.reliability.retry_after_max_seconds == 10.0


def test_apply_deployment_does_not_leak_model_key_to_other_host():
    from wai.proxy.registry import Deployment, Model
    from wai.proxy.routing import apply_deployment

    model = Model(name="m", provider="openai", base_url="https://a.example.com/v1", api_key="secret-a")
    other = apply_deployment(model, Deployment(name="d", provider="openai", base_url="https://b.example.com/v1"))
    assert other.api_key == ""
    same = apply_deployment(model, Deployment(name="d", provider="openai", base_url="https://a.example.com/openai"))
    assert same.api_key == "secret-a"
    no_url = apply_deployment(model, Deployment(name="d", provider="openai"))
    assert no_url.api_key == "secret-a" and no_url.base_url == model.base_url
    own = apply_deployment(model, Deployment(name="d", base_url="https://b.example.com/v1", api_key="k-b"))
    assert own.api_key == "k-b"


def test_client_4xx_does_not_close_half_open_circuit():
    from types import SimpleNamespace

    from wai.proxy.handler import ProxyHandler

    clock = FakeClock()
    reg = _reg(clock, circuit_failure_threshold=1, circuit_cooldown_seconds=30)
    reg.record_failure(K)
    clock.advance(30)
    ticket = reg.acquire(K)
    assert ticket == "probe"
    fake = SimpleNamespace(circuits=reg)
    ProxyHandler._settle_response(fake, K, ticket, SimpleNamespace(status_code=400, headers={}))
    assert reg.state(K) == HALF_OPEN  # bad client input says nothing about upstream health
    ticket = reg.acquire(K)
    ProxyHandler._settle_response(fake, K, ticket, SimpleNamespace(status_code=200, headers={}))
    assert reg.state(K) == CLOSED
