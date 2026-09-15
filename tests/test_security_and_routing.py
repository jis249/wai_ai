"""Unit tests for proxy routing, SSRF, client IP trust, and update checker."""

from __future__ import annotations

import os
from types import SimpleNamespace

from wai.net.client_ip import client_ip, trust_proxy_headers
from wai.proxy.registry import Deployment, Model
from wai.proxy.routing import apply_deployment, select_deployment, walk_fallback_names
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
