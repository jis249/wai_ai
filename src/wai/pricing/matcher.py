"""Match WAI models to LiteLLM catalog keys."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from wai.pricing.catalog import Catalog, CatalogEntry

# WAI provider -> LiteLLM key prefixes, most specific first.
PROVIDER_PREFIXES: dict[str, tuple[str, ...]] = {
    "azure": ("azure/", "azure_ai/"),
    "openai": ("openai/",),
    "anthropic": ("anthropic/",),
    "ollama": ("ollama/", "ollama_chat/"),
    "vllm": ("hosted_vllm/", "vllm/"),
    "vertex": ("vertex_ai/", "gemini/"),
    "custom": (),
}


@dataclass
class ModelFacts:
    """The model fields matching looks at (from a models row plus its deployments)."""

    id: str = ""
    name: str = ""
    provider: str = ""
    azure_deployment: str = ""
    pricing_key: str = ""
    deployments: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: dict[str, Any], deployments: Iterable[dict[str, Any]] = ()) -> ModelFacts:
        return cls(
            id=str(row.get("id") or ""),
            name=str(row.get("name") or ""),
            provider=str(row.get("provider") or "").lower(),
            azure_deployment=str(row.get("azure_deployment") or ""),
            pricing_key=str(row.get("pricing_key") or "").strip(),
            deployments=[dict(d) for d in deployments],
        )


@dataclass(frozen=True)
class Match:
    key: str
    entry: CatalogEntry
    via: str  # pricing_key | name | provider_prefix | azure_deployment | deployment


def _dedupe(items: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for key, via in items:
        key = key.strip()
        if key and key.lower() not in seen:
            seen.add(key.lower())
            out.append((key, via))
    return out


def _variants(name: str) -> list[str]:
    """The bare name plus loose forms: last path segment, and without an ':tag' suffix."""
    out = [name]
    if "/" in name:
        out.append(name.rsplit("/", 1)[-1])
    for n in list(out):
        if ":" in n:
            out.append(n.split(":", 1)[0])
    return out


def _prefixes(provider: str) -> tuple[str, ...]:
    provider = (provider or "").lower()
    if provider in PROVIDER_PREFIXES:
        return PROVIDER_PREFIXES[provider]
    return (f"{provider}/",) if provider else ()


def candidate_keys(model: ModelFacts) -> list[tuple[str, str]]:
    """Catalog keys to try for a model, in priority order, as (key, via).

    Provider-prefixed forms come before the bare name so e.g. an Azure model prefers the
    ``azure/...`` price over the OpenAI one when both exist.
    """
    out: list[tuple[str, str]] = []
    prefixes = _prefixes(model.provider)

    for variant in _variants(model.name):
        out.extend((f"{p}{variant}", "provider_prefix") for p in prefixes)
        out.append((variant, "name"))

    if model.azure_deployment:
        for variant in _variants(model.azure_deployment):
            out.extend((f"{p}{variant}", "azure_deployment") for p in prefixes)
            out.append((variant, "azure_deployment"))

    for dep in model.deployments:
        dep_prefixes = _prefixes(str(dep.get("provider") or model.provider))
        for field_name in ("azure_deployment", "name"):
            value = str(dep.get(field_name) or "")
            for variant in _variants(value) if value else ():
                out.extend((f"{p}{variant}", "deployment") for p in dep_prefixes)
                out.append((variant, "deployment"))
    return _dedupe(out)


def match_model(model: ModelFacts, catalog: Catalog) -> Match | None:
    """Best catalog match for a model, or None.

    A manual ``pricing_key`` is authoritative: when it is set only that key is tried.
    Otherwise the first candidate that exists *and* carries a non-zero price wins; a key that
    exists with no price (typical for local/Ollama models) is returned only if nothing priced
    matches, so the caller can report "catalog lists no price".
    """
    if model.pricing_key:
        entry = catalog.get(model.pricing_key)
        return Match(entry.key, entry, "pricing_key") if entry else None
    unpriced: Match | None = None
    for key, via in candidate_keys(model):
        entry = catalog.get(key)
        if entry is None:
            continue
        if entry.has_price:
            return Match(entry.key, entry, via)
        if unpriced is None:
            unpriced = Match(entry.key, entry, via)
    return unpriced
