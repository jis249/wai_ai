"""Custom Prometheus metrics for the LLM proxy."""

from __future__ import annotations

from prometheus_client import Counter, Histogram

PROXY_REQUESTS = Counter(
    "wai_proxy_requests_total",
    "Proxy requests by model and HTTP status class",
    ["model", "status_class"],
)
PROXY_LATENCY = Histogram(
    "wai_proxy_request_seconds",
    "Proxy request duration in seconds",
    ["model"],
)
PROXY_TOKENS = Counter(
    "wai_proxy_tokens_total",
    "Tokens observed on successful proxy requests",
    ["model", "direction"],
)
PROXY_ERRORS = Counter(
    "wai_proxy_errors_total",
    "Proxy upstream failures",
    ["model"],
)


def observe_proxy_request(
    *,
    model: str,
    status_code: int,
    duration_seconds: float,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    error: bool = False,
) -> None:
    status_class = f"{status_code // 100}xx" if status_code else "unknown"
    PROXY_REQUESTS.labels(model=model or "unknown", status_class=status_class).inc()
    PROXY_LATENCY.labels(model=model or "unknown").observe(max(duration_seconds, 0.0))
    if prompt_tokens:
        PROXY_TOKENS.labels(model=model or "unknown", direction="prompt").inc(prompt_tokens)
    if completion_tokens:
        PROXY_TOKENS.labels(model=model or "unknown", direction="completion").inc(completion_tokens)
    if error:
        PROXY_ERRORS.labels(model=model or "unknown").inc()
