"""Model catalog pricing sync admin API (system admin only)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from wai.api.admin.common import (
    KeyInfo,
    ROLE_SYSTEM_ADMIN,
    api_error,
    bad_request,
    not_found,
)
from wai.api.admin.handler import get_handler, require_role
from wai.pricing import get_fetcher, pricing_config
from wai.pricing.catalog import Catalog, CatalogError
from wai.pricing.matcher import ModelFacts, candidate_keys, match_model
from wai.pricing import service

router = APIRouter()

MAX_PRICING_KEY_LEN = 200


class ApplyRequest(BaseModel):
    model_ids: list[str] = Field(default_factory=list, max_length=2000)
    lock_to_synced: bool = False


class PricingSettingsRequest(BaseModel):
    pricing_source: Literal["manual", "synced"] | None = None
    pricing_key: str | None = Field(default=None, max_length=MAX_PRICING_KEY_LEN)


def _upstream_error(exc: CatalogError):
    return api_error(502, "pricing_source_unavailable", str(exc))


async def _catalog(request: Request, *, refresh: bool = False) -> Catalog:
    h = get_handler()
    fetcher = get_fetcher(pricing_config(request.app))
    try:
        return await service.fetch_catalog(h.db, fetcher, refresh=refresh)
    except CatalogError as exc:
        raise _upstream_error(exc) from None


def _catalog_meta(catalog: Catalog) -> dict[str, Any]:
    return {
        "source": catalog.source,
        "fetched_at": catalog.fetched_at,
        "entries": len(catalog),
    }


@router.get("/pricing/preview", tags=["pricing"])
async def pricing_preview(
    request: Request,
    refresh: bool = Query(False),
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> dict[str, Any]:
    h = get_handler()
    catalog = await _catalog(request, refresh=refresh)
    rows = await service.build_preview(h.db, catalog)
    counts = service.count_actions(rows)
    await service.update_status(h.db, last_preview_at=catalog.fetched_at, counts=counts)
    return {**_catalog_meta(catalog), "counts": counts, "rows": [r.to_dict() for r in rows]}


@router.post("/pricing/apply", tags=["pricing"])
async def pricing_apply(
    request: Request,
    body: ApplyRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> dict[str, Any]:
    ids = [i.strip() for i in body.model_ids if isinstance(i, str) and i.strip()]
    if not ids:
        raise bad_request("model_ids is required")
    h = get_handler()
    catalog = await _catalog(request)
    result = await service.apply_rows(h.db, catalog, ids, lock_to_synced=body.lock_to_synced)
    if result.updated:
        await service.reload_registries(h, request.app)
        service.audit_changes(h, result.updated, actor=key_info)
    now = service.utc_now_iso()
    await service.update_status(h.db, last_sync_at=now, last_apply_at=now, last_applied=len(result.updated))
    return {**_catalog_meta(catalog), **result.to_dict()}


@router.get("/pricing/status", tags=["pricing"])
async def pricing_status(
    request: Request,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> dict[str, Any]:
    h = get_handler()
    pc = pricing_config(request.app)
    fetcher = get_fetcher(pc)
    status = await service.read_status(h.db)
    synced = 0
    try:
        row = await h.db.fetchone(
            "SELECT COUNT(*) AS cnt FROM models WHERE deleted_at IS NULL AND pricing_source = 'synced'"
        )
        synced = int((row or {}).get("cnt") or 0)
    except Exception:
        pass
    counts = status.get("counts") if isinstance(status.get("counts"), dict) else {}
    return {
        "source": fetcher.source,
        "source_kind": "file" if fetcher.local_path else "url",
        "auto_sync": pc.auto_sync,
        "auto_sync_interval_hours": pc.auto_sync_interval_hours,
        "last_fetch_at": status.get("last_fetch_at", ""),
        "last_sync_at": status.get("last_sync_at", ""),
        "last_auto_sync_at": status.get("last_auto_sync_at", ""),
        "entries": int(status.get("entries") or 0),
        "counts": {a: int(counts.get(a) or 0) for a in service.ACTIONS},
        "synced_models": synced,
        "last_error": status.get("last_error", ""),
        "last_error_at": status.get("last_error_at", ""),
    }


@router.get("/pricing/lookup", tags=["pricing"])
async def pricing_lookup(
    request: Request,
    key: str | None = Query(None, max_length=MAX_PRICING_KEY_LEN),
    name: str = Query("", max_length=200),
    provider: str = Query("", max_length=40),
    azure_deployment: str = Query("", max_length=200),
    model_id: str = Query("", max_length=64),
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> dict[str, Any]:
    """Show the catalog entry a pricing_key (or model fields) resolves to.

    With ``model_id`` and no ``key`` parameter the model's saved pricing_key is used;
    pass ``key=`` (empty) to see the automatic match instead.
    """
    h = get_handler()
    deployments: list[dict[str, Any]] = []
    if model_id:
        row = await h.db.fetchone(
            "SELECT * FROM models WHERE id = ? AND deleted_at IS NULL", (model_id,)
        )
        if not row:
            raise not_found("model not found")
        row = dict(row)
        name = name or row.get("name") or ""
        provider = provider or row.get("provider") or ""
        azure_deployment = azure_deployment or row.get("azure_deployment") or ""
        if key is None:
            key = row.get("pricing_key") or ""
        try:
            deployments = [dict(d) for d in await h.db.fetchall(
                """SELECT name, provider, azure_deployment FROM model_deployments
                   WHERE model_id = ? AND deleted_at IS NULL""",
                (model_id,),
            )]
        except Exception:
            deployments = []
    key = key or ""
    if not (key.strip() or name.strip()):
        raise bad_request("key or name is required")
    catalog = await _catalog(request)
    facts = ModelFacts(
        id=model_id,
        name=name.strip(),
        provider=provider.strip().lower(),
        azure_deployment=azure_deployment.strip(),
        pricing_key=key.strip(),
        deployments=deployments,
    )
    match = match_model(facts, catalog)
    tried = [k for k, _ in candidate_keys(facts)] if not facts.pricing_key else [facts.pricing_key]
    if match is None:
        return {"found": False, "tried": tried[:20], **_catalog_meta(catalog)}
    e = match.entry
    return {
        "found": True,
        "match_key": match.key,
        "matched_via": match.via,
        "has_price": e.has_price,
        "input_per_1m": e.input_per_1m,
        "output_per_1m": e.output_per_1m,
        "context_window": e.context_window,
        "max_output_tokens": e.max_output_tokens,
        "litellm_provider": e.provider,
        "mode": e.mode,
        "tried": tried[:20],
        **_catalog_meta(catalog),
    }


async def _pricing_settings(h, model_id: str) -> dict[str, Any]:
    row = await h.db.fetchone(
        """SELECT id, pricing_source, pricing_key, pricing_synced_at FROM models
           WHERE id = ? AND deleted_at IS NULL""",
        (model_id,),
    )
    if not row:
        raise not_found("model not found")
    return {
        "model_id": row["id"],
        "pricing_source": row.get("pricing_source") or "manual",
        "pricing_key": row.get("pricing_key") or "",
        "pricing_synced_at": row.get("pricing_synced_at") or "",
    }


@router.get("/models/{model_id}/pricing-settings", tags=["pricing"])
async def get_pricing_settings(
    model_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> dict[str, Any]:
    return await _pricing_settings(get_handler(), model_id)


@router.put("/models/{model_id}/pricing-settings", tags=["pricing"])
async def put_pricing_settings(
    model_id: str,
    body: PricingSettingsRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> dict[str, Any]:
    h = get_handler()
    before = await _pricing_settings(h, model_id)
    await service.set_pricing_settings(
        h.db, model_id, pricing_source=body.pricing_source, pricing_key=body.pricing_key
    )
    after = await _pricing_settings(h, model_id)
    audit = getattr(h, "audit_logger", None)
    if audit is not None and (before["pricing_source"], before["pricing_key"]) != (
        after["pricing_source"], after["pricing_key"]
    ):
        from wai.audit.logger import AuditEvent

        audit.log(AuditEvent(
            org_id=key_info.org_id,
            actor_id=key_info.user_id,
            actor_type="user" if key_info.user_id else "system",
            actor_key_id=key_info.id,
            action="pricing.settings.update",
            resource_type="models",
            resource_id=model_id,
            description=(
                f"pricing_source {before['pricing_source']} -> {after['pricing_source']}, "
                f"pricing_key {before['pricing_key']!r} -> {after['pricing_key']!r}"
            ),
            status_code=200,
        ))
    return after
