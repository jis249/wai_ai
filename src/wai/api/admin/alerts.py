"""Alert channels, rules and event log (admin API).

Scope: ``org_id`` query/body parameter. Empty = platform scope (system admins only);
an org id = that org (its org admins, or system admins). Channel URLs and signing secrets
are write-only: responses carry only a masked host/path hint. A webhook channel's signing
secret is returned once, when it is created or rotated.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field

from wai.alerts import get_dispatcher
from wai.alerts.dispatcher import AlertDispatcher
from wai.alerts.models import (
    CHANNEL_KINDS,
    KIND_BUDGET,
    KIND_DIGEST,
    KIND_ERROR_RATE,
    KIND_TEST,
    SEVERITIES,
    AlertEvent,
    AlertRule,
)
from wai.alerts.sender import check_url_syntax, mask_url, validate_channel_url
from wai.alerts.store import AlertStore, new_signing_secret, rule_kinds_for
from wai.api.admin.common import (
    KeyInfo,
    ROLE_ORG_ADMIN,
    ROLE_SYSTEM_ADMIN,
    bad_request,
    forbidden,
    has_role,
    new_uuid,
    not_found,
    parse_pagination,
)
from wai.api.admin.handler import get_handler, require_role

router = APIRouter(tags=["alerts"])

MAX_CHANNELS_PER_SCOPE = 20
MAX_COOLDOWN_SECONDS = 30 * 86400


# --- models --------------------------------------------------------------------------


class ChannelResponse(BaseModel):
    id: str
    org_id: str | None = None
    name: str
    kind: str
    url_hint: str = ""
    has_secret: bool = False
    enabled: bool = True
    created_by: str = ""
    created_at: str = ""
    updated_at: str = ""
    signing_secret: str | None = None  # only on create / rotate for webhook channels


class ChannelListResponse(BaseModel):
    data: list[ChannelResponse]


class CreateChannelRequest(BaseModel):
    org_id: str | None = None
    name: str
    kind: str
    url: str
    enabled: bool = True
    secret: str | None = None


class UpdateChannelRequest(BaseModel):
    name: str | None = None
    url: str | None = None
    enabled: bool | None = None
    rotate_secret: bool = False


class TestResult(BaseModel):
    ok: bool
    status: int = 0
    error: str = ""
    attempts: int = 0
    ms: int = 0
    event_id: str = ""


class RuleResponse(BaseModel):
    kind: str
    org_id: str | None = None
    enabled: bool
    severity_min: str
    cooldown_seconds: int
    params: dict[str, Any] = Field(default_factory=dict)
    channel_ids: list[str] = Field(default_factory=list)
    updated_at: str = ""


class RuleListResponse(BaseModel):
    data: list[RuleResponse]


class UpdateRuleRequest(BaseModel):
    enabled: bool | None = None
    severity_min: str | None = None
    cooldown_seconds: int | None = None
    params: dict[str, Any] | None = None
    channel_ids: list[str] | None = None


class DeliveryStatus(BaseModel):
    channel_id: str
    name: str = ""
    kind: str = ""
    ok: bool = False
    status: int = 0
    error: str = ""
    attempts: int = 0


class EventResponse(BaseModel):
    id: str
    org_id: str | None = None
    kind: str
    severity: str
    title: str
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    delivery: list[DeliveryStatus] = Field(default_factory=list)


class EventListResponse(BaseModel):
    data: list[EventResponse]
    has_more: bool = False
    next_cursor: str | None = None


# --- helpers -------------------------------------------------------------------------


def _store() -> AlertStore:
    h = get_handler()
    return AlertStore(h.db, h.encryption_key)


def _require_org_access(key_info: KeyInfo, org_id: str) -> None:
    if not has_role(key_info.role, ROLE_SYSTEM_ADMIN) and key_info.org_id != org_id:
        raise forbidden()


def _require_scope(key_info: KeyInfo, org_id: str | None) -> str | None:
    """Normalize the scope and enforce who may manage it. Returns None for platform scope."""
    org = (org_id or "").strip() or None
    if org is None:
        if not has_role(key_info.role, ROLE_SYSTEM_ADMIN):
            raise forbidden("platform alerts are managed by system admins")
        return None
    _require_org_access(key_info, org)
    return org


def _can_see(key_info: KeyInfo, org_id: str | None) -> bool:
    if has_role(key_info.role, ROLE_SYSTEM_ADMIN):
        return True
    return bool(org_id) and key_info.org_id == org_id


async def _require_org_exists(org_id: str | None) -> None:
    if org_id is None:
        return
    row = await get_handler().db.fetchone(
        "SELECT id FROM organizations WHERE id = ? AND deleted_at IS NULL", (org_id,)
    )
    if not row:
        raise not_found("organization not found")


async def _load_channel(key_info: KeyInfo, channel_id: str) -> dict[str, Any]:
    row = await _store().get_channel_row(channel_id)
    # Out-of-scope channels are reported as missing so ids do not leak across tenants.
    if not row or not _can_see(key_info, row.get("org_id") or None):
        raise not_found("alert channel not found")
    return row


def _channel_resp(row: dict[str, Any], signing_secret: str | None = None) -> ChannelResponse:
    return ChannelResponse(
        id=row["id"],
        org_id=row.get("org_id") or None,
        name=row.get("name") or "",
        kind=row.get("kind") or "",
        url_hint=row.get("url_hint") or "",
        has_secret=bool(row.get("secret_enc")),
        enabled=bool(row.get("enabled")),
        created_by=row.get("created_by") or "",
        created_at=row.get("created_at") or "",
        updated_at=row.get("updated_at") or "",
        signing_secret=signing_secret,
    )


async def _validated_url(url: str) -> str:
    try:
        u = check_url_syntax(url)
        await validate_channel_url(u)
    except ValueError as exc:
        raise bad_request(str(exc)) from exc
    return u


def _clean_name(name: str) -> str:
    n = (name or "").strip()
    if not n or len(n) > 100:
        raise bad_request("name is required (max 100 characters)")
    return n


def _rule_resp(rule: AlertRule) -> RuleResponse:
    return RuleResponse(
        kind=rule.kind,
        org_id=rule.org_id,
        enabled=rule.enabled,
        severity_min=rule.severity_min,
        cooldown_seconds=rule.cooldown_seconds,
        params=rule.params,
        channel_ids=rule.channel_ids,
        updated_at=rule.updated_at,
    )


def _num(params: dict[str, Any], key: str, lo: float, hi: float, *, integer: bool = False) -> float | int | None:
    if key not in params or params[key] is None or params[key] == "":
        return None
    try:
        v = float(params[key])
    except (TypeError, ValueError) as exc:
        raise bad_request(f"{key} must be a number") from exc
    if not lo <= v <= hi:
        raise bad_request(f"{key} must be between {lo:g} and {hi:g}")
    return int(v) if integer else v


def _validate_params(kind: str, params: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    out = dict(current)
    if kind == KIND_BUDGET:
        if "thresholds" in params:
            raw = params["thresholds"]
            if not isinstance(raw, list) or not raw or len(raw) > 5:
                raise bad_request("thresholds must be a list of 1 to 5 percentages")
            vals = sorted({int(_num({"t": t}, "t", 1, 1000, integer=True) or 0) for t in raw})
            out["thresholds"] = vals
    elif kind == KIND_ERROR_RATE:
        for key, lo, hi, integer in (
            ("threshold_pct", 0.1, 100, False),
            ("min_requests", 1, 1_000_000, True),
            ("window_minutes", 5, 120, True),
        ):
            v = _num(params, key, lo, hi, integer=integer)
            if v is not None:
                out[key] = v
    elif kind == KIND_DIGEST:
        for key, hi in (("hour_utc", 23), ("minute_utc", 59)):
            v = _num(params, key, 0, hi, integer=True)
            if v is not None:
                out[key] = v
    return out


def _event_resp(row: dict[str, Any]) -> EventResponse:
    try:
        data = json.loads(row.get("data") or "{}")
    except ValueError:
        data = {}
    try:
        delivered = json.loads(row.get("delivered") or "{}")
    except ValueError:
        delivered = {}
    delivery = []
    if isinstance(delivered, dict):
        for cid, st in delivered.items():
            if not isinstance(st, dict):
                continue
            delivery.append(
                DeliveryStatus(
                    channel_id=str(cid),
                    name=str(st.get("name") or ""),
                    kind=str(st.get("kind") or ""),
                    ok=bool(st.get("ok")),
                    status=int(st.get("status") or 0),
                    error=str(st.get("error") or "")[:200],
                    attempts=int(st.get("attempts") or 0),
                )
            )
    return EventResponse(
        id=row["id"],
        org_id=row.get("org_id") or None,
        kind=row.get("kind") or "",
        severity=row.get("severity") or "info",
        title=row.get("title") or "",
        message=row.get("message") or "",
        data=data if isinstance(data, dict) else {},
        created_at=row.get("created_at") or "",
        delivery=delivery,
    )


# --- channels ------------------------------------------------------------------------


@router.get("/alerts/channels", response_model=ChannelListResponse)
async def list_channels(
    org_id: str | None = Query(None),
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> ChannelListResponse:
    scope = _require_scope(key_info, org_id)
    rows = await _store().list_channel_rows(scope)
    return ChannelListResponse(data=[_channel_resp(r) for r in rows])


@router.post("/alerts/channels", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_channel(
    body: CreateChannelRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> ChannelResponse:
    scope = _require_scope(key_info, body.org_id)
    await _require_org_exists(scope)
    if body.kind not in CHANNEL_KINDS:
        raise bad_request("kind must be one of: " + ", ".join(CHANNEL_KINDS))
    name = _clean_name(body.name)
    url = await _validated_url(body.url)
    store = _store()
    if len(await store.list_channel_rows(scope)) >= MAX_CHANNELS_PER_SCOPE:
        raise bad_request(f"at most {MAX_CHANNELS_PER_SCOPE} channels per scope")
    secret = ""
    if body.kind == "webhook":
        secret = (body.secret or "").strip() or new_signing_secret()
        if len(secret) < 16 or len(secret) > 256:
            raise bad_request("secret must be 16 to 256 characters")
    cid = new_uuid()
    await store.insert_channel(
        channel_id=cid, org_id=scope, name=name, kind=body.kind, url=url, url_hint=mask_url(url),
        secret=secret, enabled=body.enabled, created_by=key_info.user_id or key_info.id,
    )
    row = await store.get_channel_row(cid)
    return _channel_resp(row or {}, signing_secret=secret or None)


@router.patch("/alerts/channels/{channel_id}", response_model=ChannelResponse)
async def update_channel(
    channel_id: str,
    body: UpdateChannelRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> ChannelResponse:
    row = await _load_channel(key_info, channel_id)
    _require_scope(key_info, row.get("org_id"))
    store = _store()
    fields: dict[str, Any] = {}
    if body.name is not None:
        fields["name"] = _clean_name(body.name)
    if body.enabled is not None:
        fields["enabled"] = int(body.enabled)
    if body.url is not None and body.url.strip():
        url = await _validated_url(body.url)
        fields["url_enc"] = store.encrypt_url(channel_id, url)
        fields["url_hint"] = mask_url(url)
    new_secret: str | None = None
    if body.rotate_secret:
        if row.get("kind") != "webhook":
            raise bad_request("only webhook channels have a signing secret")
        new_secret = new_signing_secret()
        fields["secret_enc"] = store.encrypt_secret(channel_id, new_secret)
    await store.update_channel(channel_id, fields)
    updated = await store.get_channel_row(channel_id)
    return _channel_resp(updated or row, signing_secret=new_secret)


@router.delete("/alerts/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    channel_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> Response:
    row = await _load_channel(key_info, channel_id)
    scope = _require_scope(key_info, row.get("org_id"))
    await _store().delete_channel(channel_id, scope)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/alerts/channels/{channel_id}/test", response_model=TestResult)
async def test_channel(
    channel_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> TestResult:
    row = await _load_channel(key_info, channel_id)
    scope = _require_scope(key_info, row.get("org_id"))
    store = _store()
    channel = await store.get_channel(channel_id)
    if channel is None:
        raise bad_request("channel could not be decrypted; re-enter its URL")
    event = AlertEvent.create(
        id=new_uuid(),
        kind=KIND_TEST,
        severity="info",
        title="WAI test alert",
        message=f"This is a test notification for the '{channel.name}' channel. No action is needed.",
        org_id=scope,
        data={"channel": channel.name},
    )
    dispatcher = get_dispatcher() or AlertDispatcher(store)
    result = await dispatcher.send_test(channel, event)
    return TestResult(
        ok=bool(result.get("ok")),
        status=int(result.get("status") or 0),
        error=str(result.get("error") or ""),
        attempts=int(result.get("attempts") or 0),
        ms=int(result.get("ms") or 0),
        event_id=event.id,
    )


# --- rules ---------------------------------------------------------------------------


@router.get("/alerts/rules", response_model=RuleListResponse)
async def list_rules(
    org_id: str | None = Query(None),
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> RuleListResponse:
    scope = _require_scope(key_info, org_id)
    await _require_org_exists(scope)
    rules = await _store().seed_rules(scope, new_uuid)
    return RuleListResponse(data=[_rule_resp(r) for r in rules])


@router.put("/alerts/rules/{kind}", response_model=RuleResponse)
async def update_rule(
    kind: str,
    body: UpdateRuleRequest,
    org_id: str | None = Query(None),
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> RuleResponse:
    scope = _require_scope(key_info, org_id)
    if kind not in rule_kinds_for(scope):
        raise not_found("alert rule not found")
    await _require_org_exists(scope)
    store = _store()
    await store.seed_rules(scope, new_uuid)
    rule = await store.effective_rule(scope, kind)
    if body.enabled is not None:
        rule.enabled = body.enabled
    if body.severity_min is not None:
        if body.severity_min not in SEVERITIES:
            raise bad_request("severity_min must be one of: " + ", ".join(SEVERITIES))
        rule.severity_min = body.severity_min
    if body.cooldown_seconds is not None:
        if not 0 <= body.cooldown_seconds <= MAX_COOLDOWN_SECONDS:
            raise bad_request("cooldown_seconds must be between 0 and 2592000")
        rule.cooldown_seconds = int(body.cooldown_seconds)
    if body.params is not None:
        rule.params = _validate_params(kind, body.params, rule.params)
    if body.channel_ids is not None:
        ids = list(dict.fromkeys(str(c) for c in body.channel_ids))
        valid = {r["id"] for r in await store.list_channel_rows(scope)}
        unknown = [c for c in ids if c not in valid]
        if unknown:
            raise bad_request("channel_ids must reference channels in the same scope")
        rule.channel_ids = ids
    await store.update_rule(rule)
    return _rule_resp(await store.effective_rule(scope, kind))


# --- events --------------------------------------------------------------------------


@router.get("/alerts/events", response_model=EventListResponse)
async def list_events(
    org_id: str | None = Query(None),
    kind: str | None = Query(None),
    severity: str | None = Query(None),
    limit: int | None = Query(None),
    cursor: str | None = Query(None),
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> EventListResponse:
    scope = _require_scope(key_info, org_id)
    if kind and (len(kind) > 64 or not all(c.isalnum() or c in "._-" for c in kind)):
        raise bad_request("invalid kind")
    if severity and severity not in SEVERITIES:
        raise bad_request("unknown severity")
    page = parse_pagination(limit, cursor)
    # Platform scope (system admins) lists events of every scope.
    rows = await _store().list_events(
        org_id=scope, all_scopes=scope is None, kind=kind or "", severity=severity or "",
        cursor=page.cursor, limit=page.limit + 1,
    )
    has_more = len(rows) > page.limit
    rows = rows[: page.limit]
    return EventListResponse(
        data=[_event_resp(r) for r in rows],
        has_more=has_more,
        next_cursor=rows[-1]["id"] if has_more and rows else None,
    )
