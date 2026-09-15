"""Deployment selection and model fallback helpers for the LLM proxy."""

from __future__ import annotations

import random
from dataclasses import replace
from typing import Callable

from wai.proxy.registry import Deployment, Model

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


def select_deployment(model: Model, *, rng: random.Random | None = None) -> Deployment | None:
    """Pick a deployment using the model's strategy (weighted, priority, or first)."""
    deps = [d for d in model.deployments if d.base_url]
    if not deps:
        return None
    picker = rng or random
    strategy = (model.strategy or "").lower().strip()
    if strategy in {"weighted", "weight", "random"}:
        weights = [max(int(d.weight or 0), 1) for d in deps]
        return picker.choices(deps, weights=weights, k=1)[0]
    if strategy in {"priority", "failover"}:
        return sorted(deps, key=lambda d: int(d.priority or 0), reverse=True)[0]
    return deps[0]


def apply_deployment(model: Model, deployment: Deployment | None) -> Model:
    """Return a copy of ``model`` with upstream fields from ``deployment`` overlaid."""
    if deployment is None:
        return model
    return replace(
        model,
        provider=deployment.provider or model.provider,
        base_url=deployment.base_url or model.base_url,
        api_key=deployment.api_key or model.api_key,
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
