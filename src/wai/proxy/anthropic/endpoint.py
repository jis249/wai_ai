"""`POST /v1/messages` and `POST /v1/messages/count_tokens` (Anthropic-compatible).

The Anthropic request is translated to an OpenAI chat-completions body and handed to the existing
``ProxyHandler.handle(request, "chat/completions")`` on a derived Starlette Request, so auth, model
access, aliases, auto routing, guardrails, rate/spend limits, fallbacks, usage logging and caching
all apply unchanged. The derived request shares the original ASGI scope (including ``state``, so
the authenticated key and request id are visible to the audit and request-id middleware).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from wai.api.admin.common import KEY_INFO_CTX
from wai.proxy.anthropic.stream import StreamConverter, convert_stream, sse
from wai.proxy.anthropic.translate import (
    TranslationError,
    anthropic_error,
    anthropic_to_openai,
    error_type_for_status,
    estimate_input_tokens,
    extract_error,
    new_message_id,
    openai_to_anthropic,
)

log = logging.getLogger("wai.proxy.anthropic")

AuthFn = Callable[[Request], Awaitable[Any]]
HandlerGetter = Callable[[], Any]

_DEFAULT_MAX_BODY = 20 * 1024 * 1024
_PASS_HEADERS = ("retry-after",)
_PASS_PREFIXES = ("x-wai-", "x-ratelimit")


def derived_request(request: Request, body: bytes) -> Request:
    """A Request over the same scope with ``body`` as its payload.

    Anthropic clients send the key as ``x-api-key``; when no ``Authorization: Bearer`` header is
    present it is exposed to WAI's proxy auth as ``Authorization: Bearer <x-api-key>``.
    """
    headers: list[tuple[bytes, bytes]] = []
    api_key = b""
    has_bearer = False
    for name, value in request.scope.get("headers", []):
        lname = name.lower()
        if lname in (b"content-length", b"content-type"):
            continue
        if lname == b"x-api-key":
            api_key = value.strip()
            continue
        if lname == b"authorization" and value.startswith(b"Bearer "):
            has_bearer = True
        headers.append((lname, value))
    if api_key and not has_bearer:
        headers = [(n, v) for n, v in headers if n != b"authorization"]
        headers.append((b"authorization", b"Bearer " + api_key))
    headers.append((b"content-type", b"application/json"))
    headers.append((b"content-length", str(len(body)).encode()))

    scope = dict(request.scope)
    scope["headers"] = headers
    scope.setdefault("state", {})  # shared dict: key info / request id stay visible to middleware
    request.scope.setdefault("state", scope["state"])

    sent = False
    original_receive = request.receive

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await original_receive()

    return Request(scope, receive)


def _carry_key_info(source: Request, *targets: Request) -> None:
    """Copy the authenticated key to other Request objects.

    ``authenticate_bearer`` stores KeyInfo in the Request's own ``state.__dict__`` (not the shared
    scope state), so it must be copied onto the Request handed to ProxyHandler, which uses it for
    model access, aliases, guardrails, spend/rate limits and usage logging.
    """
    info = getattr(source.state, KEY_INFO_CTX, None)
    if info is None:
        return
    for target in targets:
        target.state.__dict__[KEY_INFO_CTX] = info


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "") or "")


def _pass_headers(headers: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not headers:
        return out
    for key, value in headers.items():
        lk = key.lower()
        if lk in _PASS_HEADERS or lk.startswith(_PASS_PREFIXES):
            out[key] = value
    return out


def error_response(
    status: int,
    message: str,
    *,
    error_type: str | None = None,
    request_id: str = "",
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=anthropic_error(error_type or error_type_for_status(status), message, request_id),
        headers=_pass_headers(headers) or None,
    )


def http_exception_response(exc: StarletteHTTPException, request_id: str = "") -> JSONResponse:
    _, message = extract_error(exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)})
    return error_response(exc.status_code, message, request_id=request_id, headers=exc.headers)


def _upstream_error_response(resp: Response, request_id: str) -> JSONResponse:
    _, message = extract_error(bytes(getattr(resp, "body", b"") or b""))
    return error_response(resp.status_code, message or f"upstream status {resp.status_code}", request_id=request_id, headers=resp.headers)


async def _drain(resp: StreamingResponse, limit: int = 64 * 1024) -> bytes:
    """Read (capped) and close an inner streaming response, then run its background task."""
    buf = bytearray()
    iterator = resp.body_iterator
    try:
        async for chunk in iterator:
            buf.extend(chunk if isinstance(chunk, (bytes, bytearray)) else str(chunk).encode())
            if len(buf) >= limit:
                break
    except Exception as exc:  # pragma: no cover - transport failure while reading an error body
        log.warning("anthropic: failed reading upstream error body: %s", exc)
    finally:
        aclose = getattr(iterator, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # pragma: no cover
                pass
        if getattr(resp, "background", None) is not None:
            await resp.background()
    return bytes(buf[:limit])


async def _read_json(request: Request, max_body: int) -> Any:
    body = await request.body()
    if len(body) > max_body:
        raise StarletteHTTPException(413, "request body too large")
    try:
        return json.loads(body) if body else None
    except ValueError as exc:
        raise TranslationError("request body is not valid JSON") from exc


async def handle_messages(request: Request, proxy_handler: Any, auth: AuthFn) -> Response:
    rid = _request_id(request)
    if proxy_handler is None:
        return error_response(503, "proxy is not ready", request_id=rid)
    max_body = int(getattr(proxy_handler, "max_request_body", 0) or _DEFAULT_MAX_BODY)
    try:
        # Authenticate first (same dependency as the /v1 catch-all), then validate the body.
        auth_request = derived_request(request, b"")
        await auth(auth_request)
        body = await _read_json(request, max_body)
        openai_body = anthropic_to_openai(body)
    except TranslationError as exc:
        return error_response(400, str(exc), request_id=rid)
    except StarletteHTTPException as exc:
        return http_exception_response(exc, rid)

    model = body["model"]
    stream = bool(openai_body.get("stream"))
    inner = derived_request(request, json.dumps(openai_body).encode())
    _carry_key_info(auth_request, request, inner)
    try:
        resp = await proxy_handler.handle(inner, "chat/completions")
    except StarletteHTTPException as exc:
        return http_exception_response(exc, rid)
    except Exception:
        log.exception("anthropic /v1/messages: proxy handler failed request_id=%s", rid)
        return error_response(500, "internal server error", request_id=rid)

    extra = _pass_headers(resp.headers)
    if not isinstance(resp, StreamingResponse) and getattr(resp, "background", None) is not None:
        await resp.background()  # body is already materialized; run the cleanup now
    if isinstance(resp, StreamingResponse):
        if resp.status_code >= 400:
            # Upstream refused before any event: relay a JSON error with the real status.
            raw_error = await _drain(resp)
            _, message = extract_error(raw_error)
            return error_response(
                resp.status_code,
                message or f"upstream status {resp.status_code}",
                request_id=rid,
                headers=resp.headers,
            )
        try:
            converter = StreamConverter(
                model=model,
                message_id=new_message_id(),
                input_tokens_estimate=estimate_input_tokens(body),
            )
        except Exception:
            # Close the already-open upstream stream before propagating.
            if resp.background is not None:
                await resp.background()
            raise
        return StreamingResponse(
            convert_stream(resp.body_iterator, converter),
            media_type="text/event-stream",
            headers={**extra, "Cache-Control": "no-cache"},
            # The inner response is never sent itself, so its cleanup task rides on ours.
            background=getattr(resp, "background", None),
        )

    if resp.status_code >= 400:
        return _upstream_error_response(resp, rid)
    raw = bytes(getattr(resp, "body", b"") or b"")
    try:
        doc = json.loads(raw)
    except ValueError:
        return error_response(502, "upstream returned a non-JSON response", request_id=rid)
    if not isinstance(doc, dict) or (doc.get("error") is not None and not doc.get("choices")):
        _, message = extract_error(doc)
        return error_response(502, message, request_id=rid)
    message = openai_to_anthropic(doc, model)
    if stream:
        # Defensive: a buffered response to a streaming request is replayed as events.
        return StreamingResponse(
            _replay_as_events(message),
            media_type="text/event-stream",
            headers={**extra, "Cache-Control": "no-cache"},
        )
    return JSONResponse(content=message, headers=extra or None)


async def _replay_as_events(message: dict[str, Any]):
    start = {**message, "content": [], "stop_reason": None, "stop_sequence": None}
    yield sse("message_start", {"type": "message_start", "message": start})
    for i, block in enumerate(message["content"]):
        if block["type"] == "text":
            yield sse("content_block_start", {"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            if block["text"]:
                yield sse("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": block["text"]}})
        else:
            yield sse("content_block_start", {"type": "content_block_start", "index": i, "content_block": {**block, "input": {}}})
            yield sse("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}})
        yield sse("content_block_stop", {"type": "content_block_stop", "index": i})
    yield sse(
        "message_delta",
        {"type": "message_delta", "delta": {"stop_reason": message["stop_reason"], "stop_sequence": None}, "usage": message["usage"]},
    )
    yield sse("message_stop", {"type": "message_stop"})


async def handle_count_tokens(request: Request, proxy_handler: Any, auth: AuthFn) -> Response:
    """Estimated input tokens (characters / 4, like the auto router), not a tokenizer count."""
    rid = _request_id(request)
    max_body = int(getattr(proxy_handler, "max_request_body", 0) or _DEFAULT_MAX_BODY)
    try:
        await auth(derived_request(request, b""))
        body = await _read_json(request, max_body)
        if not isinstance(body, dict):
            raise TranslationError("request body must be a JSON object")
        if not isinstance(body.get("model"), str) or not body["model"]:
            raise TranslationError("model: Field required")
        if not isinstance(body.get("messages"), list):
            raise TranslationError("messages: Field required")
    except TranslationError as exc:
        return error_response(400, str(exc), request_id=rid)
    except StarletteHTTPException as exc:
        return http_exception_response(exc, rid)
    return JSONResponse(
        content={"input_tokens": estimate_input_tokens(body)},
        headers={"X-WAI-Token-Count": "estimate"},
    )


def register_anthropic_routes(app: FastAPI, get_proxy_handler: HandlerGetter, auth: AuthFn) -> None:
    """Register the Anthropic routes. Call before the ``/v1/{path:path}`` catch-all."""

    @app.post("/v1/messages", include_in_schema=False)
    async def anthropic_messages(request: Request):
        return await handle_messages(request, get_proxy_handler(), auth)

    @app.post("/v1/messages/count_tokens", include_in_schema=False)
    async def anthropic_count_tokens(request: Request):
        return await handle_count_tokens(request, get_proxy_handler(), auth)
