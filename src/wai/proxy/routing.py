"""Deployment selection and model fallback helpers for the LLM proxy."""

from __future__ import annotations

import random
import threading
from dataclasses import replace
from typing import Callable, Collection

from wai.proxy.registry import Deployment, Model, same_host

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

_rr_lock = threading.Lock()
_rr_counters: dict[str, int] = {}


def _next_round_robin(model_name: str, counters: dict[str, int] | None) -> int:
    store = _rr_counters if counters is None else counters
    with _rr_lock:
        n = store.get(model_name, 0)
        store[model_name] = n + 1
    return n


def select_deployment(
    model: Model,
    *,
    rng: random.Random | None = None,
    inflight: dict[str, int] | None = None,
    exclude: Collection[str] | None = None,
    rr_counters: dict[str, int] | None = None,
    allow: Callable[[Deployment], bool] | None = None,
    last_failure: Callable[[Deployment], float] | None = None,
) -> Deployment | None:
    """Pick a deployment using the model's strategy.

    Strategies: weighted, priority (lower value = higher priority), round-robin
    (per-model counter), least-busy, or first. Deployments whose ``base_url`` is in
    ``exclude`` (e.g. ones that already failed this request) are skipped unless
    that would leave no candidates.

    ``allow`` (circuit breaker) filters out deployments whose circuit is open. If
    every remaining deployment is blocked, the one that failed least recently
    (``last_failure``) is returned so traffic is never blackholed.
    """
    deps = [d for d in model.deployments if d.base_url]
    if not deps:
        return None
    if exclude:
        remaining = [d for d in deps if d.base_url not in exclude]
        if remaining:
            deps = remaining
    if allow is not None:
        admitted = [d for d in deps if allow(d)]
        if admitted:
            deps = admitted
        elif last_failure is not None:
            return min(deps, key=last_failure)
    picker = rng or random
    strategy = (model.strategy or "").lower().strip()
    if strategy in {"least-busy", "least_busy", "least-latency"}:
        busy = inflight or {}
        return min(deps, key=lambda d: busy.get(d.base_url, 0))
    if strategy in {"weighted", "weight", "random"}:
        weights = [max(int(d.weight or 0), 1) for d in deps]
        return picker.choices(deps, weights=weights, k=1)[0]
    if strategy in {"priority", "failover"}:
        return min(deps, key=lambda d: int(d.priority or 0))
    if strategy in {"round-robin", "round_robin", "roundrobin", "rr"}:
        return deps[_next_round_robin(model.name, rr_counters) % len(deps)]
    return deps[0]


def is_context_window_error(status_code: int, body: bytes | str | None) -> bool:
    if status_code not in {400, 413}:
        return False
    text = body.decode("utf-8", errors="ignore") if isinstance(body, bytes) else (body or "")
    lowered = text.lower()
    return any(
        token in lowered
        for token in ("context_length", "maximum context", "context window", "too many tokens")
    )


def apply_deployment(model: Model, deployment: Deployment | None) -> Model:
    """Return a copy of ``model`` with upstream fields from ``deployment`` overlaid."""
    if deployment is None:
        return model
    return replace(
        model,
        provider=deployment.provider or model.provider,
        base_url=deployment.base_url or model.base_url,
        # Never send the model's key to a deployment on a different host.
        api_key=deployment.api_key
        or (model.api_key if not deployment.base_url or same_host(deployment.base_url, model.base_url) else ""),
        azure_deployment=deployment.azure_deployment or model.azure_deployment,
        azure_api_version=deployment.azure_api_version or model.azure_api_version,
        gcp_project=deployment.gcp_project or model.gcp_project,
        gcp_location=deployment.gcp_location or model.gcp_location,
    )


def fallback_depth_limit(configured: int) -> int:
    """Treat unset/zero config as a small default chain; never unbounded."""
    if configured and configured > 0:
        return min(configured, 16)
    return 5


def walk_fallback_names(start: Model, resolve: Callable[[str], Model], *, max_depth: int) -> list[Model]:
    """Walk ``fallback_model_name`` links without cycles."""
    chain: list[Model] = []
    seen: set[str] = set()
    current: Model | None = start
    depth = 0
    while current is not None and current.name not in seen and depth <= max_depth:
        seen.add(current.name)
        chain.append(current)
        nxt = (current.fallback_model_name or "").strip()
        if not nxt:
            break
        depth += 1
        if depth > max_depth:
            break
        try:
            current = resolve(nxt)
        except Exception:
            break
    return chain
