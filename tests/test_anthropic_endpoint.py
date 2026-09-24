"""/v1/messages endpoint: auth (x-api-key), ProxyHandler delegation, errors, streaming, route order."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from wai.api.admin import handler as handler_mod
from wai.api.admin.common import KEY_INFO_CTX, KEY_TYPE_USER, KeyInfo, api_error, generate_key, hash_key, limit_reached
from wai.api.admin.handler import Handler
from wai.middleware.request_id import RequestIDMiddleware
from wai.proxy.anthropic import register_anthropic_routes
from wai.proxy.auth import proxy_auth_middleware
from wai.proxy.handler import ProxyHandler
from wai.proxy.registry import Model, Registry

RID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"


@pytest.fixture
def api_key(monkeypatch) -> str:
    h = Handler(db=None, encryption_key=b"k" * 32)  # type: ignore[arg-type]
    monkeypatch.setattr(handler_mod, "_handler", h)
    token = generate_key(KEY_TYPE_USER)
    h.key_cache.set(hash_key(token, h.hmac_secret), KeyInfo(id="key1", key_type=KEY_TYPE_USER, role="member", org_id="o1"))
    return token


class FakeProxy:
    max_request_body = 1024 * 1024

    def __init__(self, response: Any = None, exc: Exception | None = None) -> None:
        self.response = response
        self.exc = exc
        self.calls: list[dict[str, Any]] = []

    async def handle(self, request: Request, path: str):
        body = await request.body()
        self.calls.append(
            {
                "path": path,
                "body": json.loads(body),
                "headers": dict(request.headers),
                "key_info": getattr(request.state, KEY_INFO_CTX, None),
                "request_id": getattr(request.state, "request_id", ""),
            }
        )
        if self.exc is not None:
            raise self.exc
        return self.response


def _app(proxy: Any) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    register_anthropic_routes(app, lambda: proxy, proxy_auth_middleware)

    @app.api_route("/v1/{path:path}", methods=["GET", "POST"])
    async def catch_all(request: Request, path: str):
        return {"catch_all": path}

    return app


async def _post(app: FastAPI, path: str, body: Any, headers: dict[str, str]) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://wai") as client:
        return await client.post(path, json=body, headers=headers)


BODY = {"model": "claude-x", "max_tokens": 32, "system": "sys", "messages": [{"role": "user", "content": "hi"}]}
COMPLETION = {
    "id": "chatcmpl-9",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 4, "completion_tokens": 1, "total_tokens": 5},
}


async def test_x_api_key_auth_and_delegation(api_key):
    proxy = FakeProxy(Response(content=json.dumps(COMPLETION), media_type="application/json", headers={"X-WAI-Cache": "MISS"}))
    resp = await _post(
        _app(proxy),
        "/v1/messages",
        BODY,
        {"x-api-key": api_key, "anthropic-version": "2023-06-01", "X-Request-Id": RID},
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["type"] == "message" and doc["model"] == "claude-x"
    assert doc["content"] == [{"type": "text", "text": "hello"}]
    assert doc["usage"]["input_tokens"] == 4 and doc["usage"]["output_tokens"] == 1
    assert resp.headers["x-wai-cache"] == "MISS"
    assert resp.headers["x-request-id"] == RID

    call = proxy.calls[0]
    assert call["path"] == "chat/completions"
    assert call["body"]["messages"] == [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}]
    assert call["headers"]["authorization"] == f"Bearer {api_key}"
    assert "x-api-key" not in call["headers"]
    assert call["headers"]["x-request-id"] == RID
    assert call["request_id"] == RID
    assert call["key_info"].id == "key1"


async def test_bearer_auth_still_works(api_key):
    proxy = FakeProxy(Response(content=json.dumps(COMPLETION), media_type="application/json"))
    resp = await _post(_app(proxy), "/v1/messages", BODY, {"Authorization": f"Bearer {api_key}"})
    assert resp.status_code == 200


@pytest.mark.parametrize("headers", [{}, {"x-api-key": "wa_uk_bogus"}, {"x-api-key": "not-a-key"}])
async def test_auth_failures_are_anthropic_errors(api_key, headers):
    proxy = FakeProxy()
    resp = await _post(_app(proxy), "/v1/messages", BODY, headers)
    assert resp.status_code == 401
    assert resp.json()["type"] == "error"
    assert resp.json()["error"]["type"] == "authentication_error"
    assert proxy.calls == []


async def test_validation_error_after_auth(api_key):
    body = {k: v for k, v in BODY.items() if k != "max_tokens"}
    resp = await _post(_app(FakeProxy()), "/v1/messages", body, {"x-api-key": api_key})
    assert resp.status_code == 400
    assert resp.json()["error"] == {"type": "invalid_request_error", "message": "max_tokens: Field required"}


@pytest.mark.parametrize(
    "exc, status, etype",
    [
        (api_error(404, "model_not_found", "the requested model was not found"), 404, "not_found_error"),
        (api_error(403, "model_access_denied", "model access denied"), 403, "permission_error"),
        (limit_reached("requests per minute limit reached", retry_after=17), 429, "rate_limit_error"),
        (api_error(502, "bad_gateway", "upstream unavailable"), 502, "api_error"),
    ],
)
async def test_proxy_exceptions_map_to_anthropic_errors(api_key, exc, status, etype):
    resp = await _post(_app(FakeProxy(exc=exc)), "/v1/messages", BODY, {"x-api-key": api_key})
    assert resp.status_code == status
    assert resp.json()["error"]["type"] == etype
    assert resp.json()["error"]["message"] == exc.detail["error"]["message"]
    if status == 429:
        assert resp.headers["retry-after"] == "17"


async def test_upstream_error_response_preserves_status(api_key):
    upstream = Response(
        content=b'{"error":{"message":"context too long","type":"invalid_request_error"}}',
        status_code=400,
        media_type="application/json",
    )
    resp = await _post(_app(FakeProxy(upstream)), "/v1/messages", BODY, {"x-api-key": api_key})
    assert resp.status_code == 400
    assert resp.json()["error"] == {"type": "invalid_request_error", "message": "context too long"}
    assert resp.json()["request_id"]


async def test_streaming_through_fake_proxy(api_key):
    async def upstream():
        yield b'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n'
        yield b"\n"
        yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n'
        yield b'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n'
        yield b"data: [DONE]\n"

    proxy = FakeProxy(StreamingResponse(upstream(), media_type="text/event-stream", headers={"X-WAI-Routed-Model": "m"}))
    resp = await _post(_app(proxy), "/v1/messages", {**BODY, "stream": True}, {"x-api-key": api_key})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.headers["x-wai-routed-model"] == "m"
    events = [line[7:] for line in resp.text.split("\n") if line.startswith("event: ")]
    assert events == [
        "message_start",
        "ping",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
    ]
    assert proxy.calls[0]["body"]["stream"] is True


async def test_count_tokens(api_key):
    proxy = FakeProxy()
    resp = await _post(_app(proxy), "/v1/messages/count_tokens", {"model": "m", "messages": [{"role": "user", "content": "x" * 40}]}, {"x-api-key": api_key})
    assert resp.status_code == 200
    assert resp.json() == {"input_tokens": 10}
    assert resp.headers["x-wai-token-count"] == "estimate"
    assert proxy.calls == []
    unauth = await _post(_app(proxy), "/v1/messages/count_tokens", {"model": "m", "messages": []}, {})
    assert unauth.status_code == 401 and unauth.json()["error"]["type"] == "authentication_error"


async def test_route_precedence_over_catch_all(api_key):
    app = _app(FakeProxy(Response(content=json.dumps(COMPLETION), media_type="application/json")))
    resp = await _post(app, "/v1/messages", BODY, {"x-api-key": api_key})
    assert resp.json()["type"] == "message"
    other = await _post(app, "/v1/chat/completions", {}, {})
    assert other.json() == {"catch_all": "chat/completions"}


def test_app_registers_anthropic_routes_before_catch_all():
    src = (Path(__file__).resolve().parents[1] / "src" / "wai" / "app.py").read_text(encoding="utf-8")
    reg = src.index("register_anthropic_routes(target_app")
    catch_all = src.index('"/v1/{path:path}"')
    assert reg < catch_all
    assert "proxy_auth_middleware)" in src[reg : reg + 200]


# --- end to end through the real ProxyHandler (upstream faked with MockTransport) -------------


class UsageSink:
    def __init__(self) -> None:
        self.events: list[Any] = []

    def log(self, event: Any) -> None:
        self.events.append(event)


def _real_proxy(respond, usage: UsageSink | None = None) -> ProxyHandler:
    registry = Registry()
    registry.add_model(Model(name="claude-x", base_url="http://upstream"))
    ph = ProxyHandler(registry, usage_logger=usage)
    ph._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    return ph


async def test_end_to_end_tool_use_via_proxy_handler(api_key):
    seen: dict[str, Any] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-e2e",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "f", "arguments": '{"a":2}'}}],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 20, "completion_tokens": 3, "total_tokens": 23},
            },
        )

    usage = UsageSink()
    ph = _real_proxy(respond, usage)
    body = {**BODY, "tools": [{"name": "f", "input_schema": {"type": "object"}}], "tool_choice": {"type": "any"}}
    try:
        resp = await _post(_app(ph), "/v1/messages", body, {"x-api-key": api_key})
    finally:
        await ph.close()
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["content"] == [{"type": "tool_use", "id": "call_1", "name": "f", "input": {"a": 2}}]
    assert doc["stop_reason"] == "tool_use"
    assert seen["url"] == "http://upstream/chat/completions"
    assert seen["body"]["tool_choice"] == "required"
    assert seen["body"]["tools"][0]["function"]["name"] == "f"
    assert seen["auth"] is None  # the client's WAI key is never forwarded upstream
    # Usage is attributed to the key authenticated from x-api-key (KeyInfo reached ProxyHandler).
    assert len(usage.events) == 1
    assert usage.events[0].key_id == "key1" and usage.events[0].total_tokens == 23


async def test_end_to_end_streaming_via_proxy_handler(api_key):
    seen: dict[str, Any] = {}
    sse = (
        b'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n'
        b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
        b'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n'
        b"data: [DONE]\n\n"
    )

    def respond(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})

    usage = UsageSink()
    ph = _real_proxy(respond, usage)
    try:
        resp = await _post(_app(ph), "/v1/messages", {**BODY, "stream": True}, {"x-api-key": api_key})
    finally:
        await ph.close()
    assert seen["body"]["stream"] is True and seen["body"]["stream_options"] == {"include_usage": True}
    datas = [json.loads(line[6:]) for line in resp.text.split("\n") if line.startswith("data: ")]
    assert [d["type"] for d in datas] == [
        "message_start",
        "ping",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
    ]
    assert datas[3]["delta"] == {"type": "text_delta", "text": "Hi"}
    assert datas[5]["delta"]["stop_reason"] == "end_turn"
    assert datas[5]["usage"]["output_tokens"] == 1 and datas[5]["usage"]["input_tokens"] == 5
    assert len(usage.events) == 1 and usage.events[0].key_id == "key1" and usage.events[0].total_tokens == 6


async def test_end_to_end_streaming_upstream_error_status(api_key):
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b'{"error":{"message":"bad upstream key","code":"invalid_api_key"}}')

    ph = _real_proxy(respond)
    try:
        resp = await _post(_app(ph), "/v1/messages", {**BODY, "stream": True}, {"x-api-key": api_key})
    finally:
        await ph.close()
    if resp.status_code == 401:
        # ProxyHandler surfaces the upstream status before streaming: plain JSON error.
        assert resp.json()["error"] == {"type": "authentication_error", "message": "bad upstream key"}
    else:
        # Older ProxyHandler: 200 stream carrying the raw error body -> `event: error`.
        events = [line[7:] for line in resp.text.split("\n") if line.startswith("event: ")]
        assert events == ["message_start", "ping", "error"]
        assert '"authentication_error"' in resp.text and "bad upstream key" in resp.text


async def test_streaming_error_status_from_proxy_becomes_json_error(api_key):
    cleaned = []

    async def body():
        yield b'{"error":{"message":"slow down","type":"rate_limit_exceeded"}}'

    async def cleanup():
        cleaned.append(True)

    inner = StreamingResponse(body(), status_code=429, headers={"Retry-After": "3"}, background=BackgroundTask(cleanup))
    resp = await _post(_app(FakeProxy(inner)), "/v1/messages", {**BODY, "stream": True}, {"x-api-key": api_key})
    assert resp.status_code == 429
    assert resp.json()["error"] == {"type": "rate_limit_error", "message": "slow down"}
    assert resp.headers["retry-after"] == "3"
    assert cleaned == [True]
