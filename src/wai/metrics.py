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


# --- reliability: circuit breakers and retries ---------------------------------

from prometheus_client import Gauge  # noqa: E402

CIRCUIT_STATE = Gauge(
    "wai_circuit_state",
    "Deployment circuit breaker state (0=closed, 1=half_open, 2=open)",
    ["model", "deployment"],
)
CIRCUIT_TRANSITIONS = Counter(
    "wai_circuit_transitions_total",
    "Deployment circuit breaker transitions into a state",
    ["model", "deployment", "state"],
)
PROXY_RETRIES = Counter(
    "wai_proxy_retries_total",
    "Proxy retry attempts after an upstream failure",
    ["model", "reason"],
)
PROXY_FALLBACKS = Counter(
    "wai_proxy_fallbacks_total",
    "Proxy fallbacks from one model to the next in its fallback chain",
    ["model"],
)


def observe_circuit_state(model: str, deployment: str, value: int, transition: str = "") -> None:
    CIRCUIT_STATE.labels(model=model or "unknown", deployment=deployment or "default").set(value)
    if transition:
        CIRCUIT_TRANSITIONS.labels(
            model=model or "unknown", deployment=deployment or "default", state=transition
        ).inc()


def forget_circuit(model: str, deployment: str) -> None:
    try:
        CIRCUIT_STATE.remove(model or "unknown", deployment or "default")
    except KeyError:
        pass


def observe_retry(model: str, reason: str) -> None:
    PROXY_RETRIES.labels(model=model or "unknown", reason=reason or "error").inc()


def observe_fallback(model: str) -> None:
    PROXY_FALLBACKS.labels(model=model or "unknown").inc()
