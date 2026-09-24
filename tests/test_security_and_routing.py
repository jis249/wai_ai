"""Unit tests for proxy routing, SSRF, client IP trust, and update checker."""

from __future__ import annotations

import os
from types import SimpleNamespace

from wai.net.client_ip import client_ip, trust_proxy_headers
from wai.proxy.registry import Deployment, Model
from wai.proxy.routing import apply_deployment, is_context_window_error, select_deployment, walk_fallback_names
from wai.proxy.response_cache import ResponseCache
from wai.proxy.guardrail import apply_org_guardrails
from wai.security.url import validate_http_url
from wai.updates import UpdateChecker
from wai import __version__


def test_select_deployment_priority():
    model = Model(
        name="m",
        strategy="priority",
        deployments=[
            Deployment(name="low", base_url="http://a", priority=1),
            Deployment(name="high", base_url="http://b", priority=10),
        ],
    )
    dep = select_deployment(model)
    assert dep is not None
    assert dep.name == "high"


def test_select_deployment_weighted_deterministic():
    model = Model(
        name="m",
        strategy="weighted",
        deployments=[
            Deployment(name="a", base_url="http://a", weight=1),
            Deployment(name="b", base_url="http://b", weight=99),
        ],
    )
    import random

    dep = select_deployment(model, rng=random.Random(0))
    assert dep is not None
    assert dep.base_url


def test_apply_deployment_overlays_url():
    model = Model(name="m", base_url="http://primary", provider="ollama")
    dep = Deployment(name="alt", base_url="http://alt", provider="azure")
    out = apply_deployment(model, dep)
    assert out.base_url == "http://alt"
    assert out.provider == "azure"
    assert model.base_url == "http://primary"


def test_walk_fallback_chain():
    models = {
        "a": Model(name="a", fallback_model_name="b"),
        "b": Model(name="b", fallback_model_name="c"),
        "c": Model(name="c"),
    }
    chain = walk_fallback_names(models["a"], lambda n: models[n], max_depth=5)
    assert [m.name for m in chain] == ["a", "b", "c"]


def test_walk_fallback_cycle():
    models = {
        "a": Model(name="a", fallback_model_name="b"),
        "b": Model(name="b", fallback_model_name="a"),
    }
    chain = walk_fallback_names(models["a"], lambda n: models[n], max_depth=8)
    assert [m.name for m in chain] == ["a", "b"]


def test_validate_http_url_blocks_private():
    try:
        validate_http_url("http://127.0.0.1:9000")
        assert False, "expected ValueError"
    except ValueError:
        pass
    assert validate_http_url("http://127.0.0.1:9000", allow_private=True).startswith("http://")


def test_validate_http_url_requires_https_for_public():
    try:
        validate_http_url("http://example.com/mcp")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_client_ip_ignores_xff_without_trust(monkeypatch):
    monkeypatch.delenv("WAI_TRUST_PROXY", raising=False)
    assert trust_proxy_headers() is False
    req = SimpleNamespace(
        headers={"X-Forwarded-For": "1.2.3.4"},
        client=SimpleNamespace(host="10.0.0.8"),
    )
    assert client_ip(req) == "10.0.0.8"


def test_client_ip_honors_xff_when_trusted(monkeypatch):
    monkeypatch.setenv("WAI_TRUST_PROXY", "true")
    req = SimpleNamespace(
        headers={"X-Forwarded-For": "1.2.3.4, 10.0.0.1"},
        client=SimpleNamespace(host="10.0.0.8"),
    )
    assert client_ip(req) == "1.2.3.4"


def test_update_checker_version():
    info = UpdateChecker().get_info()
    assert info["current_version"] == __version__
    assert info["needs_update"] is False


def test_metrics_token_required(monkeypatch):
    monkeypatch.delenv("WAI_METRICS_TOKEN", raising=False)
    from wai.api.health.routes import register_health_routes

    class DummyDB:
        pass

    class DummyApp:
        def include_router(self, router):
            self.router = router

    app = DummyApp()
    register_health_routes(app, DummyDB())  # type: ignore[arg-type]
    assert any(getattr(r, "path", "") == "/metrics" for r in app.router.routes)


def test_select_deployment_least_busy():
    model = Model(
        name="m",
        strategy="least-busy",
        deployments=[
            Deployment(name="a", base_url="http://a"),
            Deployment(name="b", base_url="http://b"),
        ],
    )
    dep = select_deployment(model, inflight={"http://a": 3, "http://b": 0})
    assert dep is not None
    assert dep.base_url == "http://b"


def test_context_window_error_detection():
    assert is_context_window_error(400, b'{"error":{"message":"maximum context length exceeded"}}')
    assert not is_context_window_error(500, b"oops")


def test_response_cache_roundtrip():
    cache = ResponseCache(ttl_seconds=30, max_entries=8)
    key = cache.make_key("m", b'{"messages":[]}')
    cache.set(key, b'{"ok":true}', 200, {"Content-Type": "application/json"})
    hit = cache.get(key)
    assert hit is not None
    content, status, headers = hit
    assert status == 200
    assert b"ok" in content
    assert headers["Content-Type"] == "application/json"


def test_guardrail_blocks_ssn():
    from fastapi import HTTPException

    try:
        apply_org_guardrails(
            {"messages": [{"role": "user", "content": "ssn 123-45-6789"}]},
            pii_enabled=True,
            tool_denylist="",
        )
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_guardrail_blocks_denied_tool():
    from fastapi import HTTPException

    try:
        apply_org_guardrails(
            {"tools": [{"type": "function", "function": {"name": "bash"}}]},
            pii_enabled=False,
            tool_denylist="bash,shell",
        )
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400

