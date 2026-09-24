"""Tests for proxy fixes: tenant-scoped cache, routing strategies, retries, Luhn, SSRF DNS."""

from __future__ import annotations

import asyncio
import socket
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from wai.proxy.guardrail import apply_org_guardrails, luhn_valid
from wai.proxy.handler import ProxyHandler, _error_message, request_timeout
from wai.proxy.registry import Deployment, Model, Registry
from wai.proxy.response_cache import ResponseCache, cache_bypass_requested
from wai.proxy.routing import select_deployment
from wai.security.url import is_private_host, validate_http_url


# --- response cache ---------------------------------------------------------


def test_cache_key_is_tenant_scoped():
    cache = ResponseCache()
    body = b'{"model":"m","messages":[]}'
    k1 = cache.make_key("m", body, scope="org-a")
    k2 = cache.make_key("m", body, scope="org-b")
    assert k1 != k2
    assert k1 == cache.make_key("m", body, scope="org-a")
    cache.set(k1, b"a", 200, {})
    assert cache.get(k2) is None


def test_cache_bypass_headers():
    assert cache_bypass_requested({"cache-control": "no-cache"})
    assert cache_bypass_requested({"cache-control": "max-age=0, no-store"})
    assert cache_bypass_requested({"x-wai-cache": "bypass"})
    assert not cache_bypass_requested({"cache-control": "max-age=60"})
    assert not cache_bypass_requested({})


# --- routing ----------------------------------------------------------------


def _deps(n: int) -> list[Deployment]:
    return [Deployment(name=f"d{i}", base_url=f"http://d{i}") for i in range(n)]


def test_priority_lower_value_wins():
    model = Model(
        name="m",
        strategy="priority",
        deployments=[
            Deployment(name="c", base_url="http://c", priority=5),
            Deployment(name="a", base_url="http://a", priority=0),
            Deployment(name="b", base_url="http://b", priority=2),
        ],
    )
    assert select_deployment(model).name == "a"
    assert select_deployment(model, exclude={"http://a"}).name == "b"


def test_round_robin_cycles_per_model():
    counters: dict[str, int] = {}
    m1 = Model(name="m1", strategy="round-robin", deployments=_deps(3))
    m2 = Model(name="m2", strategy="round-robin", deployments=_deps(2))
    picks = [select_deployment(m1, rr_counters=counters).name for _ in range(4)]
    assert picks == ["d0", "d1", "d2", "d0"]
    assert select_deployment(m2, rr_counters=counters).name == "d0"


def test_exclude_falls_back_when_all_excluded():
    model = Model(name="m", deployments=_deps(2))
    assert select_deployment(model, exclude={"http://d0"}).name == "d1"
    assert select_deployment(model, exclude={"http://d0", "http://d1"}).name == "d0"


def test_request_timeout_per_model():
    t = request_timeout(Model(name="m", timeout=timedelta(seconds=30)))
    assert isinstance(t, httpx.Timeout)
    assert t.read == 30
    assert request_timeout(Model(name="m")) is httpx.USE_CLIENT_DEFAULT


def test_error_message_extraction():
    assert _error_message(b'{"error":{"message":"bad  key\\n"}}') == "bad key"
    assert _error_message(b"x" * 2000) == "x" * 500
    assert _error_message(b"") == ""


# --- handler retries --------------------------------------------------------


class _FakeUsageLogger:
    def __init__(self) -> None:
        self.events = []

    def log(self, event) -> None:
        self.events.append(event)


def _key_info():
    return SimpleNamespace(
        id="k1",
        key_type="user",
        org_id="org-1",
        team_id="",
        user_id="u1",
        service_account_id="",
        org_guardrail_pii=False,
        org_guardrail_tool_denylist="",
    )


def _request(body: bytes, key_info=None):
    async def _body() -> bytes:
        return body

    state = SimpleNamespace(request_id="rid-1")
    if key_info is not None:
        from wai.api.admin.common import KEY_INFO_CTX

        setattr(state, KEY_INFO_CTX, key_info)
    return SimpleNamespace(body=_body, state=state, headers={}, method="POST")


def test_retry_moves_to_other_deployment():
    registry = Registry()
    registry.add_model(
        Model(
            name="m",
            strategy="priority",
            max_retries=2,
            deployments=[
                Deployment(name="bad", base_url="http://bad", priority=0),
                Deployment(name="good", base_url="http://good", priority=1),
            ],
        )
    )
    handler = ProxyHandler(registry)
    tried: list[str] = []

    async def fake_forward(request, *, model, **kwargs):
        tried.append(model.base_url)
        if model.base_url == "http://bad":
            raise httpx.ConnectError("boom")
        return "ok"

    handler._forward = fake_forward  # type: ignore[assignment]

    async def run():
        try:
            return await handler.handle(_request(b'{"model":"m"}'), "chat/completions")
        finally:
            await handler.close()

    assert asyncio.run(run()) == "ok"
    assert tried == ["http://bad", "http://good"]


def test_final_failure_logged_to_request_logs():
    registry = Registry()
    registry.add_model(Model(name="m", base_url="http://x"))
    usage = _FakeUsageLogger()
    handler = ProxyHandler(registry, usage_logger=usage)

    async def fake_forward(request, *, model, **kwargs):
        raise httpx.ConnectError("boom")

    handler._forward = fake_forward  # type: ignore[assignment]

    async def run():
        try:
            await handler.handle(_request(b'{"model":"m"}', _key_info()), "chat/completions")
        finally:
            await handler.close()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())
    assert exc.value.status_code == 502
    assert len(usage.events) == 1
    ev = usage.events[0]
    assert ev.status_code == 502 and not ev.is_success
    assert "boom" in ev.error


def test_stream_usage_logged_on_client_disconnect():
    registry = Registry()
    usage = _FakeUsageLogger()
    handler = ProxyHandler(registry, usage_logger=usage)
    lines = (
        b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
        b'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\n'
        b"data: [DONE]\n\n"
    )

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=lines, headers={"content-type": "text/event-stream"})

    handler._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    model = Model(name="m", base_url="http://x")

    async def run():
        resp = await handler._stream_response(
            "POST",
            "http://x/chat/completions",
            {},
            b"{}",
            None,
            key_info=_key_info(),
            model=model,
            requested_model_name="m",
            request_id="rid",
            started=0.0,
        )
        it = resp.body_iterator
        seen = []
        async for chunk in it:
            seen.append(chunk)
            if b"usage" in chunk:
                break  # simulate client disconnect before [DONE]
        await it.aclose()
        await handler.close()
        return seen

    asyncio.run(run())
    assert len(usage.events) == 1
    assert usage.events[0].total_tokens == 4
    assert usage.events[0].status_code == 200


def test_stream_error_status_logged():
    registry = Registry()
    usage = _FakeUsageLogger()
    handler = ProxyHandler(registry, usage_logger=usage)

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b'{"error":{"message":"invalid api key"}}')

    handler._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))

    async def run():
        resp = await handler._stream_response(
            "POST",
            "http://x/chat/completions",
            {},
            b"{}",
            None,
            key_info=_key_info(),
            model=Model(name="m", base_url="http://x"),
            requested_model_name="m",
            request_id="rid",
            started=0.0,
        )
        async for _ in resp.body_iterator:
            pass
        await handler.close()

    asyncio.run(run())
    assert len(usage.events) == 1
    assert usage.events[0].status_code == 401
    assert usage.events[0].error == "invalid api key"


# --- guardrail Luhn ---------------------------------------------------------


def test_luhn():
    assert luhn_valid("4111111111111111")
    assert luhn_valid("378282246310005")
    assert not luhn_valid("4111111111111112")
    assert not luhn_valid("")


def _pii_blocks(text: str) -> bool:
    try:
        apply_org_guardrails(
            {"messages": [{"role": "user", "content": text}]}, pii_enabled=True, tool_denylist=""
        )
        return False
    except HTTPException:
        return True


def test_guardrail_card_requires_luhn():
    assert _pii_blocks("card 4111 1111 1111 1111 exp 12/29")
    assert _pii_blocks("card 4111-1111-1111-1111")
    assert _pii_blocks("4111 1111 1111 1111 12")  # trailing group dropped
    assert not _pii_blocks("order id 1234567890123456")  # fails Luhn
    assert not _pii_blocks("timestamp 1727136000000 ms")  # 13 digits, fails Luhn
    assert not _pii_blocks("0000000000000000")


# --- SSRF DNS resolution ----------------------------------------------------


def _fake_getaddrinfo(mapping):
    def fake(host, port, *args, **kwargs):
        if host not in mapping:
            raise socket.gaierror("not found")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in mapping[host]]

    return fake


def test_ssrf_rejects_hostname_resolving_to_private(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        _fake_getaddrinfo(
            {
                "internal.example.com": ["10.0.0.5"],
                "mixed.example.com": ["93.184.216.34", "169.254.169.254"],
                "public.example.com": ["93.184.216.34"],
            }
        ),
    )
    with pytest.raises(ValueError):
        validate_http_url("https://internal.example.com/mcp")
    with pytest.raises(ValueError):
        validate_http_url("https://mixed.example.com/mcp")
    with pytest.raises(ValueError):
        validate_http_url("https://nxdomain.example.com/mcp")
    assert validate_http_url("https://public.example.com/mcp") == "https://public.example.com/mcp"
    # allow_private keeps the old opt-out (e.g. local Ollama / internal MCP) and skips DNS.
    assert validate_http_url("http://internal.example.com/mcp", allow_private=True)
    assert is_private_host("internal.example.com")
    assert not is_private_host("public.example.com")


def test_ssrf_literal_ranges():
    for url in (
        "https://127.0.0.1/",
        "https://[::1]/",
        "https://169.254.169.254/",
        "https://100.64.0.1/",
        "https://0.0.0.0/",
        "https://[::ffff:10.0.0.1]/",
        "https://localhost/",
    ):
        with pytest.raises(ValueError):
            validate_http_url(url)
