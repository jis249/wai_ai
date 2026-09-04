"""Usage query handlers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from wai.api.admin.common import (
    KeyInfo,
    ROLE_MEMBER,
    ROLE_ORG_ADMIN,
    ROLE_SYSTEM_ADMIN,
    bad_request,
    forbidden,
    has_role,
    internal_error,
)
from wai.api.admin.handler import auth_middleware, get_handler, require_role
from wai.api.admin import repository as repo
from wai.proxy.auto_router_settings import load_auto_router_config

router = APIRouter()

MAX_USAGE_RANGE_DAYS = 90
VALID_GROUP_BY_ORG = {"", "model", "team", "key", "user", "day", "hour"}
VALID_GROUP_BY_SYS = VALID_GROUP_BY_ORG | {"org"}


class UsageDataPoint(BaseModel):
    group_key: str = ""
    group_label: str = ""
    total_requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_estimate: float = 0
    avg_duration_ms: float = 0


class UsageResponse(BaseModel):
    org_id: str = ""
    from_: str = Field(alias="from")
    to: str
    group_by: str = ""
    data: list[UsageDataPoint] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


def _parse_range(from_str: str, to_str: str) -> tuple[datetime, datetime]:
    if not from_str:
        raise bad_request("from is required")
    if not to_str:
        raise bad_request("to is required")
    try:
        from_dt = datetime.fromisoformat(from_str.replace("Z", "+00:00"))
        to_dt = datetime.fromisoformat(to_str.replace("Z", "+00:00"))
    except ValueError:
        raise bad_request("from and to must be valid RFC3339 timestamps")
    if from_dt >= to_dt:
        raise bad_request("from must be before to")
    if to_dt - from_dt > timedelta(days=MAX_USAGE_RANGE_DAYS):
        raise bad_request("time range must not exceed 90 days")
    return from_dt, to_dt


def _points(aggs: list[dict]) -> list[UsageDataPoint]:
    return [
        UsageDataPoint(
            group_key=a.get("group_key") or "",
            group_label=a.get("group_label") or "",
            total_requests=int(a.get("total_requests") or 0),
            prompt_tokens=int(a.get("prompt_tokens") or 0),
            completion_tokens=int(a.get("completion_tokens") or 0),
            total_tokens=int(a.get("total_tokens") or 0),
            cost_estimate=float(a.get("cost_estimate") or 0),
            avg_duration_ms=float(a.get("avg_duration_ms") or 0),
        )
        for a in aggs
    ]


async def _enrich_group_labels(db, org_id: str, group_by: str, aggs: list[dict]) -> list[dict]:
    if not aggs:
        return aggs
    if group_by == "team":
        rows = await db.fetchall(
            "SELECT id, name FROM teams WHERE org_id = ? AND deleted_at IS NULL",
            (org_id,),
        )
        names = {row["id"]: row["name"] for row in rows}
        for agg in aggs:
            agg["group_label"] = names.get(agg.get("group_key") or "", agg.get("group_key") or "")
    elif group_by == "user":
        user_ids = [agg.get("group_key") for agg in aggs if agg.get("group_key")]
        if user_ids:
            placeholders = ",".join("?" * len(user_ids))
            rows = await db.fetchall(
                f"SELECT id, display_name, email FROM users WHERE id IN ({placeholders}) AND deleted_at IS NULL",
                tuple(user_ids),
            )
            names = {row["id"]: row["display_name"] or row["email"] for row in rows}
            for agg in aggs:
                agg["group_label"] = names.get(agg.get("group_key") or "", agg.get("group_key") or "")
    return aggs


@router.get("/usage/me", response_model=UsageResponse)
async def my_usage(
    from_: str = Query(alias="from"),
    to: str = Query(),
    group_by: str = Query(""),
    key_info: KeyInfo = Depends(auth_middleware),
) -> UsageResponse:
    h = get_handler()
    from_dt, to_dt = _parse_range(from_, to)
    if group_by not in VALID_GROUP_BY_ORG:
        raise bad_request("group_by must be one of: model, team, key, user, day, hour")
    aggs = await repo.get_scoped_usage_aggregates(
        h.db, key_info.org_id, key_info.team_id, key_info.user_id,
        from_dt.isoformat(), to_dt.isoformat(), group_by,
    )
    aggs = await _enrich_group_labels(h.db, key_info.org_id, group_by, aggs)
    return UsageResponse(
        org_id=key_info.org_id,
        **{"from": from_dt.isoformat()},
        to=to_dt.isoformat(),
        group_by=group_by,
        data=_points(aggs),
    )


@router.get("/usage", response_model=UsageResponse)
async def system_admin_usage(
    from_: str = Query(alias="from"),
    to: str = Query(),
    group_by: str = Query(""),
    org_id: str = Query(""),
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> UsageResponse:
    h = get_handler()
    from_dt, to_dt = _parse_range(from_, to)
    if group_by not in VALID_GROUP_BY_SYS:
        raise bad_request("group_by must be one of: org, model, team, key, user, day, hour")
    oid = org_id or ""
    aggs = await repo.get_scoped_usage_aggregates(
        h.db, oid, "", "", from_dt.isoformat(), to_dt.isoformat(), group_by,
    )
    return UsageResponse(
        org_id=oid,
        **{"from": from_dt.isoformat()},
        to=to_dt.isoformat(),
        group_by=group_by,
        data=_points(aggs),
    )


@router.get("/orgs/{org_id}/usage", response_model=UsageResponse)
async def get_org_usage(
    org_id: str,
    from_: str = Query(alias="from"),
    to: str = Query(),
    group_by: str = Query(""),
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> UsageResponse:
    h = get_handler()
    if not has_role(key_info.role, ROLE_SYSTEM_ADMIN) and key_info.org_id != org_id:
        raise forbidden()
    from_dt, to_dt = _parse_range(from_, to)
    if group_by not in VALID_GROUP_BY_ORG:
        raise bad_request("group_by must be one of: model, team, key, user, day, hour")
    aggs = await repo.get_scoped_usage_aggregates(
        h.db, org_id, "", "", from_dt.isoformat(), to_dt.isoformat(), group_by,
    )
    aggs = await _enrich_group_labels(h.db, org_id, group_by, aggs)
    return UsageResponse(
        org_id=org_id,
        **{"from": from_dt.isoformat()},
        to=to_dt.isoformat(),
        group_by=group_by,
        data=_points(aggs),
    )


class AutoRoutingUsageRow(BaseModel):
    org_id: str = ""
    org_label: str = ""
    user_id: str = ""
    user_label: str = ""
    routed_model: str = ""
    total_requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_estimate: float = 0


class AutoRoutingModelUsage(BaseModel):
    routed_model: str = ""
    total_requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_estimate: float = 0


class AutoRoutingUsageResponse(BaseModel):
    org_id: str = ""
    from_: str = Field(alias="from")
    to: str
    default_model: str = ""
    total_requests: int = 0
    total_tokens: int = 0
    cost_estimate: float = 0
    by_user_model: list[AutoRoutingUsageRow] = Field(default_factory=list)
    by_model: list[AutoRoutingModelUsage] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


async def _current_auto_router_default_model(db, request: Request | None = None) -> str:
    from wai.config.models import AutoRouterSettings

    yaml_settings = AutoRouterSettings()
    if request is not None:
        cfg = getattr(request.app.state, "config", None)
        if cfg is not None:
            yaml_settings = cfg.settings.auto_router
        ph = getattr(request.app.state, "proxy_handler", None)
        if ph is not None and getattr(ph, "auto_router", None) is not None:
            return ph.auto_router.config.default_model
    current = await load_auto_router_config(db, yaml_settings)
    return current.default_model


async def _enrich_auto_routing_labels(db, rows: list[dict], *, include_org: bool) -> list[dict]:
    if not rows:
        return rows
    user_ids = [r.get("user_id") for r in rows if r.get("user_id")]
    if user_ids:
        placeholders = ",".join("?" * len(user_ids))
        name_rows = await db.fetchall(
            f"SELECT id, display_name, email FROM users WHERE id IN ({placeholders}) AND deleted_at IS NULL",
            tuple(user_ids),
        )
        names = {row["id"]: row["display_name"] or row["email"] for row in name_rows}
        for row in rows:
            uid = row.get("user_id") or ""
            row["user_label"] = names.get(uid, uid or "—")
    if include_org:
        org_ids = list({r.get("org_id") for r in rows if r.get("org_id")})
        if org_ids:
            placeholders = ",".join("?" * len(org_ids))
            org_rows = await db.fetchall(
                f"SELECT id, name FROM orgs WHERE id IN ({placeholders}) AND deleted_at IS NULL",
                tuple(org_ids),
            )
            org_names = {row["id"]: row["name"] for row in org_rows}
            for row in rows:
                oid = row.get("org_id") or ""
                row["org_label"] = org_names.get(oid, oid or "—")
    return rows


def _auto_routing_response(
    raw: dict,
    rows: list[dict],
    *,
    org_id: str,
    from_iso: str,
    to_iso: str,
    include_org: bool,
    default_model: str = "",
) -> AutoRoutingUsageResponse:
    return AutoRoutingUsageResponse(
        org_id=org_id,
        **{"from": from_iso},
        to=to_iso,
        default_model=default_model,
        total_requests=int(raw.get("total_requests") or 0),
        total_tokens=int(raw.get("total_tokens") or 0),
        cost_estimate=float(raw.get("cost_estimate") or 0),
        by_user_model=[
            AutoRoutingUsageRow(
                org_id=r.get("org_id") or "",
                org_label=r.get("org_label") or ("" if not include_org else r.get("org_id") or "—"),
                user_id=r.get("user_id") or "",
                user_label=r.get("user_label") or r.get("user_id") or "—",
                routed_model=r.get("routed_model") or "",
                total_requests=int(r.get("total_requests") or 0),
                prompt_tokens=int(r.get("prompt_tokens") or 0),
                completion_tokens=int(r.get("completion_tokens") or 0),
                total_tokens=int(r.get("total_tokens") or 0),
                cost_estimate=float(r.get("cost_estimate") or 0),
            )
            for r in rows
        ],
        by_model=[
            AutoRoutingModelUsage(
                routed_model=r.get("routed_model") or "",
                total_requests=int(r.get("total_requests") or 0),
                prompt_tokens=int(r.get("prompt_tokens") or 0),
                completion_tokens=int(r.get("completion_tokens") or 0),
                total_tokens=int(r.get("total_tokens") or 0),
                cost_estimate=float(r.get("cost_estimate") or 0),
            )
            for r in raw.get("by_model") or []
        ],
    )


@router.get("/usage/me/auto", response_model=AutoRoutingUsageResponse)
async def my_auto_routing_usage(
    request: Request,
    from_: str = Query(alias="from"),
    to: str = Query(),
    key_info: KeyInfo = Depends(auth_middleware),
) -> AutoRoutingUsageResponse:
    h = get_handler()
    from_dt, to_dt = _parse_range(from_, to)
    default_model = await _current_auto_router_default_model(h.db, request)
    raw = await repo.get_auto_routing_usage(
        h.db,
        from_dt.isoformat(),
        to_dt.isoformat(),
        org_id=key_info.org_id,
        team_id=key_info.team_id,
        user_id=key_info.user_id,
    )
    rows = await _enrich_auto_routing_labels(h.db, raw.get("by_user_model") or [], include_org=False)
    return _auto_routing_response(
        raw, rows, org_id=key_info.org_id,
        from_iso=from_dt.isoformat(), to_iso=to_dt.isoformat(), include_org=False,
        default_model=default_model,
    )


@router.get("/usage/auto", response_model=AutoRoutingUsageResponse)
async def system_admin_auto_routing_usage(
    request: Request,
    from_: str = Query(alias="from"),
    to: str = Query(),
    org_id: str = Query(""),
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> AutoRoutingUsageResponse:
    h = get_handler()
    from_dt, to_dt = _parse_range(from_, to)
    default_model = await _current_auto_router_default_model(h.db, request)
    oid = org_id or ""
    raw = await repo.get_auto_routing_usage(
        h.db,
        from_dt.isoformat(),
        to_dt.isoformat(),
        org_id=oid,
    )
    rows = await _enrich_auto_routing_labels(
        h.db, raw.get("by_user_model") or [], include_org=not oid,
    )
    return _auto_routing_response(
        raw, rows, org_id=oid,
        from_iso=from_dt.isoformat(), to_iso=to_dt.isoformat(), include_org=not oid,
        default_model=default_model,
    )


@router.get("/orgs/{org_id}/usage/auto", response_model=AutoRoutingUsageResponse)
async def get_org_auto_routing_usage(
    org_id: str,
    request: Request,
    from_: str = Query(alias="from"),
    to: str = Query(),
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> AutoRoutingUsageResponse:
    h = get_handler()
    if not has_role(key_info.role, ROLE_SYSTEM_ADMIN) and key_info.org_id != org_id:
        raise forbidden()
    from_dt, to_dt = _parse_range(from_, to)
    default_model = await _current_auto_router_default_model(h.db, request)
    raw = await repo.get_auto_routing_usage(
        h.db,
        from_dt.isoformat(),
        to_dt.isoformat(),
        org_id=org_id,
    )
    rows = await _enrich_auto_routing_labels(h.db, raw.get("by_user_model") or [], include_org=False)
    return _auto_routing_response(
        raw, rows, org_id=org_id,
        from_iso=from_dt.isoformat(), to_iso=to_dt.isoformat(), include_org=False,
        default_model=default_model,
    )
