"""OpenAI-compatible /v1/* proxy handler."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx
from fastapi import Request
from fastapi.responses import Response, StreamingResponse

from wai.api.admin.common import KEY_INFO_CTX, KeyInfo, api_error
from wai.metrics import observe_proxy_request
from wai.proxy.access import AliasCache, ModelAccessCache
from wai.proxy.auto_router import (
    AUTO_MODEL_NAME,
    AutoRouter,
    AutoRouterConfig,
    RoutingDecision,
    candidates_from_models,
)
from wai.proxy.providers import get_adapter
from wai.proxy.registry import ERR_MODEL_NOT_FOUND, Model, Registry
from wai.proxy.guardrail import apply_org_guardrails
from wai.proxy.response_cache import ResponseCache, cache_bypass_requested
from wai.proxy.routing import (
    RETRYABLE_STATUS,
    apply_deployment,
    fallback_depth_limit,
    is_context_window_error,
    select_deployment,
    walk_fallback_names,
)
from wai.usage.event import UsageEvent, UsageInfo, extract_usage, observe_stream_usage_line

ALLOWED_PATHS = {
    "chat/completions",
    "completions",
    "embeddings",
    "models",
    "responses",
}

ALLOWED_REQUEST_HEADERS = {
    "content-type",
    "accept",
    "accept-language",
    "x-request-id",
}


def is_allowed_path(path: str) -> bool:
    p = path.lstrip("/")
    if p in ALLOWED_PATHS:
        return True
    return p.startswith("images/") or p.startswith("audio/") or p.startswith("models/")


_ERROR_MESSAGE_MAX = 500


def _error_message(content: bytes | None) -> str:
    """Extract a short error message from an upstream error body (OpenAI shape or raw)."""
    if not content:
        return ""
    text = content.decode("utf-8", errors="replace")
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        doc = None
    if isinstance(doc, dict):
        err = doc.get("error")
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            text = err["message"]
        elif isinstance(err, str):
            text = err
        elif isinstance(doc.get("message"), str):
            text = doc["message"]
    text = " ".join(text.split())
    return text[:_ERROR_MESSAGE_MAX]


def request_timeout(model: Model) -> httpx.Timeout | Any:
    """Per-model upstream timeout, or the client default when the model sets none."""
    try:
        seconds = model.timeout.total_seconds() if model.timeout else 0.0
    except AttributeError:
        seconds = float(model.timeout or 0)
    if seconds > 0:
        return httpx.Timeout(seconds, connect=min(10.0, seconds))
    return httpx.USE_CLIENT_DEFAULT


def mutate_request_body(body: bytes, canonical_model: str, inject_usage: bool) -> bytes:
    try:
        doc = json.loads(body)
    except json.JSONDecodeError:
        return body
    doc["model"] = canonical_model
    if inject_usage:
        doc["stream_options"] = {"include_usage": True}
    return json.dumps(doc).encode()


class ProxyHandler:
    def __init__(
        self,
        registry: Registry,
        *,
        access_cache: ModelAccessCache | None = None,
        alias_cache: AliasCache | None = None,
        usage_logger: Any = None,
        log: logging.Logger | None = None,
        max_request_body: int = 20 * 1024 * 1024,
        max_response_body: int = 50 * 1024 * 1024,
        max_stream_duration: float = 300.0,
        auto_router_config: AutoRouterConfig | None = None,
        fallback_max_depth: int = 0,
        health_checker: Any = None,
        rate_limiter: Any = None,
    ) -> None:
        self.registry = registry
        self.access_cache = access_cache
        self.alias_cache = alias_cache
        self.usage_logger = usage_logger
        self.log = log or logging.getLogger("wai.proxy")
        self.max_request_body = max_request_body
        self.max_response_body = max_response_body
        self.max_stream_duration = max_stream_duration
        self.fallback_max_depth = fallback_max_depth
        self.health_checker = health_checker
        self.rate_limiter = rate_limiter
        self.response_cache = ResponseCache()
        self._inflight: dict[str, int] = {}
        self.auto_router = AutoRouter(auto_router_config or AutoRouterConfig(), log=self.log)
        self._client = httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(600.0, connect=10.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=50),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def handle(self, request: Request, path: str) -> Response:
        started = time.perf_counter()
        body = await request.body()
        if len(body) > self.max_request_body:
            raise api_error(413, "payload_too_large", "request body too large")

        try:
            envelope = json.loads(body) if body else {}
        except json.JSONDecodeError:
            envelope = {}

        model_name = envelope.get("model", "")
        stream = bool(envelope.get("stream", False))
        if not model_name:
            raise api_error(400, "bad_request", "model field is required")

        key_info: KeyInfo | None = getattr(request.state, KEY_INFO_CTX, None)
        if key_info is not None:
            apply_org_guardrails(
                envelope,
                pii_enabled=bool(key_info.org_guardrail_pii),
                tool_denylist=key_info.org_guardrail_tool_denylist,
            )
        requested_model_name = model_name
        upstream_path = path.lstrip("/")
        if not is_allowed_path(upstream_path):
            raise api_error(400, "bad_request", "unsupported API endpoint")

        routing: RoutingDecision | None = None
        resolve_name = self._apply_alias(key_info, model_name)
        if resolve_name == AUTO_MODEL_NAME:
            if not self.auto_router.config.enabled:
                raise api_error(404, "model_not_found", "the requested model was not found")
            if upstream_path not in {"chat/completions", "completions", "embeddings"}:
                raise api_error(
                    400,
                    "bad_request",
                    "auto model routing is only supported on chat/completions, completions, and embeddings",
                )
            model, routing = await self._route_auto(key_info, envelope, upstream_path)
        else:
            model = self._resolve_model(key_info, model_name)

        extra_headers = routing.as_headers(requested_model_name) if routing else {}
        chain = walk_fallback_names(
            model,
            lambda name: self._resolve_model(key_info, name),
            max_depth=fallback_depth_limit(self.fallback_max_depth),
        )
        if self.health_checker is not None:
            healthy = [m for m in chain if not self.health_checker.is_unhealthy(m.name)]
            if healthy:
                chain = healthy
        last_exc: Exception | None = None
        last_model: Model = model
        for idx, candidate in enumerate(chain):
            retries = max(int(candidate.max_retries or 0), 0)
            attempts = retries + 1
            failed: set[str] = set()
            for attempt in range(attempts):
                # Reselect per attempt so retries move off deployments that already failed.
                deployed = apply_deployment(
                    candidate,
                    select_deployment(candidate, inflight=self._inflight, exclude=failed),
                )
                last_model = deployed
                inflight_key = deployed.base_url or deployed.name
                self._inflight[inflight_key] = self._inflight.get(inflight_key, 0) + 1
                try:
                    return await self._forward(
                        request,
                        body=body,
                        model=deployed,
                        original_model_name=model_name,
                        stream=stream,
                        upstream_path=upstream_path,
                        key_info=key_info,
                        requested_model_name=requested_model_name,
                        started=started,
                        extra_headers=extra_headers,
                    )
                except (httpx.RequestError, httpx.HTTPStatusError) as exc:
                    last_exc = exc
                    if deployed.base_url:
                        failed.add(deployed.base_url)
                    body_preview = b""
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
                        body_preview = exc.response.content or b""
                        if is_context_window_error(exc.response.status_code, body_preview):
                            self.log.info("context-window fallback from %s", deployed.name)
                            break
                    self.log.warning(
                        "upstream error model=%s attempt=%s: %s",
                        deployed.name,
                        attempt + 1,
                        exc,
                    )
                    observe_proxy_request(
                        model=deployed.name,
                        status_code=502,
                        duration_seconds=time.perf_counter() - started,
                        error=True,
                    )
                    continue
                finally:
                    self._inflight[inflight_key] = max(0, self._inflight.get(inflight_key, 1) - 1)
            if idx < len(chain) - 1:
                self.log.info("falling back from %s to %s", candidate.name, chain[idx + 1].name)

        err_msg = str(last_exc) if last_exc else "upstream unavailable"
        if isinstance(last_exc, httpx.HTTPStatusError) and last_exc.response is not None:
            err_msg = f"upstream status {last_exc.response.status_code}: " + _error_message(
                last_exc.response.content
            )
        self._log_error(
            key_info,
            last_model,
            status_code=502,
            error=err_msg,
            started=started,
            request_id=getattr(request.state, "request_id", "") or "",
            requested_model_name=requested_model_name,
            upstream_path=upstream_path,
        )
        raise api_error(502, "bad_gateway", str(last_exc) if last_exc else "upstream unavailable")

    async def _forward(
        self,
        request: Request,
        *,
        body: bytes,
        model: Model,
        original_model_name: str,
        stream: bool,
        upstream_path: str,
        key_info: KeyInfo | None,
        requested_model_name: str,
        started: float,
        extra_headers: dict[str, str],
    ) -> Response:
        adapter = get_adapter(model.provider)
        needs_model_replace = original_model_name != model.name
        needs_stream_opts = stream
        fwd_body = body
        if needs_model_replace or needs_stream_opts:
            fwd_body = mutate_request_body(body, model.name, needs_stream_opts)

        if adapter is not None:
            fwd_body = adapter.transform_request(fwd_body, model)

        if adapter is not None:
            upstream_url = adapter.transform_url(model.base_url, upstream_path, model)
        else:
            upstream_url = model.base_url.rstrip("/") + "/" + upstream_path

        headers = self._build_upstream_headers(request, model, adapter)
        method = request.method.upper()
        request_id = getattr(request.state, "request_id", "") or ""

        cache_key = ""
        if (
            not stream
            and method == "POST"
            and upstream_path in {"chat/completions", "completions", "embeddings"}
            and not cache_bypass_requested(request.headers)
        ):
            # Tenant-scoped: identical bodies from different orgs never share entries.
            cache_scope = key_info.org_id if key_info is not None else ""
            cache_key = self.response_cache.make_key(model.name, fwd_body, scope=cache_scope)
            cached = self.response_cache.get(cache_key)
            if cached is not None:
                content, status_code, cached_headers = cached
                extra_headers = {**(extra_headers or {}), **cached_headers, "X-WAI-Cache": "HIT"}
                duration_s = time.perf_counter() - started
                if self.usage_logger is not None and key_info is not None:
                    usage = extract_usage(content)
                    self._log_usage(
                        key_info,
                        model,
                        usage,
                        duration_ms=int(duration_s * 1000),
                        ttft_ms=int(duration_s * 1000),
                        status_code=status_code,
                        request_id=request_id,
                        requested_model_name=requested_model_name,
                        cache_hit=True,
                    )
                return Response(
                    content=content,
                    status_code=status_code,
                    headers=extra_headers,
                    media_type=cached_headers.get("Content-Type", "application/json"),
                )

        if stream:
            return await self._stream_response(
                method,
                upstream_url,
                headers,
                fwd_body,
                adapter,
                key_info=key_info,
                model=model,
                requested_model_name=requested_model_name,
                request_id=request_id,
                started=started,
                extra_headers=extra_headers,
                upstream_path=upstream_path,
            )

        resp = await self._client.request(
            method,
            upstream_url,
            content=fwd_body,
            headers=headers,
            timeout=request_timeout(model),
        )
        if resp.status_code in RETRYABLE_STATUS:
            observe_proxy_request(
                model=model.name,
                status_code=resp.status_code,
                duration_seconds=time.perf_counter() - started,
                error=True,
            )
            raise httpx.HTTPStatusError("retryable upstream status", request=resp.request, response=resp)

        content = resp.content
        if len(content) > self.max_response_body:
            raise api_error(502, "bad_gateway", "upstream response too large")
        if adapter is not None:
            content = adapter.transform_response(content)

        duration_s = time.perf_counter() - started
        out_headers = self._filter_response_headers(resp.headers)
        if extra_headers:
            out_headers.update(extra_headers)
        out_headers["X-WAI-Cache"] = "MISS"
        if cache_key:
            self.response_cache.set(cache_key, content, resp.status_code, out_headers)
        if (
            self.usage_logger is not None
            and key_info is not None
            and upstream_path in {"chat/completions", "completions", "embeddings"}
            and 200 <= resp.status_code < 300
        ):
            duration_ms = int(duration_s * 1000)
            usage = extract_usage(content)
            self._log_usage(
                key_info,
                model,
                usage,
                duration_ms=duration_ms,
                ttft_ms=duration_ms,
                status_code=resp.status_code,
                request_id=request_id,
                requested_model_name=requested_model_name,
            )
            observe_proxy_request(
                model=model.name,
                status_code=resp.status_code,
                duration_seconds=duration_s,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
            )
        else:
            observe_proxy_request(
                model=model.name,
                status_code=resp.status_code,
                duration_seconds=duration_s,
                error=resp.status_code >= 400,
            )
            if not 200 <= resp.status_code < 300:
                self._log_error(
                    key_info,
                    model,
                    status_code=resp.status_code,
                    error=_error_message(content),
                    started=started,
                    request_id=request_id,
                    requested_model_name=requested_model_name,
                    upstream_path=upstream_path,
                )

        return Response(
            content=content,
            status_code=resp.status_code,
            headers=out_headers,
            media_type=resp.headers.get("content-type"),
        )

    def _apply_alias(self, key_info: KeyInfo | None, model_name: str) -> str:
        if self.alias_cache and key_info:
            canonical, ok = self.alias_cache.resolve(key_info.org_id, key_info.team_id, model_name)
            if ok:
                return canonical
        return model_name

    def _accessible_models(self, key_info: KeyInfo | None) -> list[Model]:
        models: list[Model] = []
        for info in self.registry.list_info():
            if info.name == AUTO_MODEL_NAME:
                continue
            if self.access_cache and key_info:
                if not self.access_cache.check(
                    key_info.org_id, key_info.team_id, key_info.id, info.name
                ):
                    continue
            try:
                models.append(self.registry.resolve(info.name))
            except KeyError:
                continue
        return models

    def _desired_type_for_path(self, upstream_path: str) -> str:
        if upstream_path == "embeddings":
            return "embedding"
        return "chat"

    async def _route_auto(
        self,
        key_info: KeyInfo | None,
        envelope: dict[str, Any],
        upstream_path: str,
    ) -> tuple[Model, RoutingDecision]:
        accessible = self._accessible_models(key_info)
        desired = self._desired_type_for_path(upstream_path)
        candidates = candidates_from_models(accessible, model_type=desired)
        if not candidates:
            raise api_error(
                403,
                "model_access_denied",
                f"no accessible {desired} models available for auto routing",
            )

        classifier: Model | None = None
        cfg_name = self.auto_router.config.classifier_model
        try:
            classifier = self.registry.resolve(cfg_name)
            if self.access_cache and key_info:
                if not self.access_cache.check(
                    key_info.org_id, key_info.team_id, key_info.id, classifier.name
                ):
                    classifier = None
        except KeyError:
            classifier = None

        def build_headers(model: Model, adapter: Any) -> dict[str, str]:
            headers = {"Content-Type": "application/json", "User-Agent": "WAI/0.1"}
            if adapter is not None:
                return adapter.set_headers(headers, model)
            if model.api_key:
                headers["Authorization"] = f"Bearer {model.api_key}"
            return headers

        decision = await self.auto_router.route(
            envelope,
            candidates,
            classifier_model=classifier,
            client=self._client,
            build_headers=build_headers,
        )
        model = self._resolve_model(key_info, decision.model_name)
        return model, decision

    def _resolve_model(self, key_info: KeyInfo | None, model_name: str) -> Model:
        model_name = self._apply_alias(key_info, model_name)
        if model_name == AUTO_MODEL_NAME:
            raise api_error(404, "model_not_found", "the requested model was not found")
        try:
            model = self.registry.resolve(model_name)
        except KeyError as exc:
            if str(exc) == ERR_MODEL_NOT_FOUND or ERR_MODEL_NOT_FOUND in str(exc):
                raise api_error(404, "model_not_found", "the requested model was not found") from exc
            raise
        if self.access_cache and key_info:
            if not self.access_cache.check(key_info.org_id, key_info.team_id, key_info.id, model.name):
                raise api_error(403, "model_access_denied", "model access denied")
        return model

    def _build_upstream_headers(
        self, request: Request, model: Model, adapter: Any
    ) -> dict[str, str]:
        headers: dict[str, str] = {}
        if ct := request.headers.get("content-type"):
            headers["Content-Type"] = ct
        if accept := request.headers.get("accept"):
            headers["Accept"] = accept
        if lang := request.headers.get("accept-language"):
            headers["Accept-Language"] = lang
        if rid := request.headers.get("x-request-id"):
            headers["X-Request-ID"] = rid
        headers["User-Agent"] = "WAI/0.1"
        if adapter is not None:
            headers = adapter.set_headers(headers, model)
        elif model.api_key:
            headers["Authorization"] = f"Bearer {model.api_key}"
        return headers

    async def _stream_response(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes,
        adapter: Any,
        *,
        key_info: KeyInfo | None,
        model: Model,
        requested_model_name: str,
        request_id: str,
        started: float,
        extra_headers: dict[str, str] | None = None,
        upstream_path: str = "chat/completions",
    ) -> StreamingResponse:
        usage = UsageInfo()
        ttft_ms: int | None = None
        status_code = 0
        first_chunk = True
        error_body = bytearray()
        stream_error = ""

        async def event_generator():
            nonlocal usage, ttft_ms, status_code, first_chunk
            async with self._client.stream(
                method, url, content=body, headers=headers, timeout=request_timeout(model)
            ) as resp:
                status_code = resp.status_code
                async for line in resp.aiter_lines():
                    if not 200 <= status_code < 300 and len(error_body) < _ERROR_MESSAGE_MAX:
                        error_body.extend((line + "\n").encode())
                    chunk = (line + "\n").encode()
                    if first_chunk and line.startswith("data: "):
                        ttft_ms = int((time.perf_counter() - started) * 1000)
                        first_chunk = False
                    if adapter is not None:
                        out = adapter.transform_stream_line(chunk)
                        if out is None:
                            continue
                        chunk = out
                    usage = observe_stream_usage_line(chunk, usage)
                    yield chunk

        async def wrapped_generator():
            nonlocal stream_error
            try:
                async for chunk in event_generator():
                    yield chunk
            except httpx.RequestError as exc:
                stream_error = f"upstream stream error: {exc}"
                self.log.warning("upstream stream error model=%s: %s", model.name, exc)
                raise
            finally:
                # Runs on normal completion, upstream failure, and client disconnect
                # (GeneratorExit / cancellation), so partial usage is not lost.
                if self.usage_logger is not None and key_info is not None:
                    if 200 <= status_code < 300:
                        duration_ms = int((time.perf_counter() - started) * 1000)
                        self._log_usage(
                            key_info,
                            model,
                            usage,
                            duration_ms=duration_ms,
                            ttft_ms=ttft_ms if ttft_ms is not None else duration_ms,
                            status_code=status_code,
                            request_id=request_id,
                            requested_model_name=requested_model_name,
                        )
                    else:
                        self._log_error(
                            key_info,
                            model,
                            status_code=status_code or 502,
                            error=stream_error or _error_message(bytes(error_body)),
                            started=started,
                            request_id=request_id,
                            requested_model_name=requested_model_name,
                            upstream_path=upstream_path,
                        )

        return StreamingResponse(
            wrapped_generator(),
            media_type="text/event-stream",
            headers=extra_headers or None,
        )

    def _log_usage(
        self,
        key_info: KeyInfo,
        model: Model,
        usage: UsageInfo,
        *,
        duration_ms: int,
        ttft_ms: int,
        status_code: int,
        request_id: str,
        requested_model_name: str,
        cache_hit: bool = False,
        error: str = "",
    ) -> None:
        if self.usage_logger is None:
            return

        cost: float | None = None
        if model.pricing.input_per_1m > 0 or model.pricing.output_per_1m > 0:
            cost = (
                usage.prompt_tokens / 1_000_000 * model.pricing.input_per_1m
                + usage.completion_tokens / 1_000_000 * model.pricing.output_per_1m
            )

        tps: float | None = None
        if duration_ms > 0 and usage.completion_tokens > 0:
            tps = usage.completion_tokens / (duration_ms / 1000.0)

        self.usage_logger.log(
            UsageEvent(
                key_id=key_info.id,
                key_type=key_info.key_type,
                org_id=key_info.org_id,
                team_id=key_info.team_id,
                user_id=key_info.user_id,
                service_account_id=key_info.service_account_id,
                model_name=model.name,
                requested_model_name=requested_model_name,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                total_tokens=usage.total_tokens,
                cost_estimate=cost,
                request_duration_ms=duration_ms,
                ttft_ms=ttft_ms,
                tokens_per_second=tps,
                status_code=status_code,
                request_id=request_id,
                cache_hit=cache_hit,
                error=error,
            )
        )
        limiter = self.rate_limiter
        if limiter is not None and usage.total_tokens > 0:
            import asyncio

            try:
                loop = asyncio.get_running_loop()
                loop.create_task(limiter.check_token_usage(key_info, usage.total_tokens))
            except RuntimeError:
                pass

    def _log_error(
        self,
        key_info: KeyInfo | None,
        model: Model,
        *,
        status_code: int,
        error: str,
        started: float,
        request_id: str,
        requested_model_name: str,
        upstream_path: str,
    ) -> None:
        """Record a failed (non-2xx) proxied request in request_logs."""
        if self.usage_logger is None or key_info is None:
            return
        if upstream_path not in {"chat/completions", "completions", "embeddings"}:
            return
        duration_ms = int((time.perf_counter() - started) * 1000)
        self.log.warning(
            "proxy request failed model=%s status=%s request_id=%s: %s",
            model.name,
            status_code,
            request_id,
            error,
        )
        self._log_usage(
            key_info,
            model,
            UsageInfo(),
            duration_ms=duration_ms,
            ttft_ms=duration_ms,
            status_code=status_code,
            request_id=request_id,
            requested_model_name=requested_model_name,
            error=error[:_ERROR_MESSAGE_MAX] or f"upstream status {status_code}",
        )

    @staticmethod
    def _filter_response_headers(headers: httpx.Headers) -> dict[str, str]:
        out: dict[str, str] = {}
        if ct := headers.get("content-type"):
            out["Content-Type"] = ct
        for key, value in headers.items():
            if key.lower().startswith("x-ratelimit"):
                out[key] = value
        return out
