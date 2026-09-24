"""API key handlers."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel

from wai.api.admin.common import (
    KEY_TYPE_SA,
    KEY_TYPE_SESSION,
    KEY_TYPE_TEAM,
    KEY_TYPE_USER,
    KeyInfo,
    ROLE_MEMBER,
    ROLE_ORG_ADMIN,
    ROLE_SYSTEM_ADMIN,
    ROLE_RANK,
    ROLE_TEAM_ADMIN,
    bad_request,
    forbidden,
    generate_key,
    has_role,
    hash_key,
    hint_key,
    internal_error,
    not_found,
    parse_pagination,
)
from wai.api.admin.handler import get_handler, parse_key_expiry, require_role, resolve_key_role
from wai.api.admin import repository as repo

router = APIRouter()

VALID_KEY_TYPES = {KEY_TYPE_USER, KEY_TYPE_TEAM, KEY_TYPE_SA}


class CreateAPIKeyRequest(BaseModel):
    name: str
    key_type: str
    team_id: str | None = None
    user_id: str | None = None
    service_account_id: str | None = None
    daily_token_limit: int = 0
    monthly_token_limit: int = 0
    requests_per_minute: int = 0
    requests_per_day: int = 0
    monthly_spend_limit: float = 0
    expires_at: str | None = None


class UpdateAPIKeyRequest(BaseModel):
    name: str | None = None
    daily_token_limit: int | None = None
    monthly_token_limit: int | None = None
    requests_per_minute: int | None = None
    requests_per_day: int | None = None
    monthly_spend_limit: float | None = None
    expires_at: str | None = None


class CreateAPIKeyResponse(BaseModel):
    id: str
    key: str
    key_hint: str
    key_type: str
    name: str
    org_id: str
    team_id: str | None = None
    user_id: str | None = None
    service_account_id: str | None = None
    daily_token_limit: int
    monthly_token_limit: int
    requests_per_minute: int
    requests_per_day: int
    monthly_spend_limit: float = 0
    expires_at: str | None = None
    created_by: str
    created_at: str
    updated_at: str


class APIKeyResponse(BaseModel):
    id: str
    key_hint: str
    key_type: str
    name: str
    org_id: str
    team_id: str | None = None
    user_id: str | None = None
    service_account_id: str | None = None
    daily_token_limit: int
    monthly_token_limit: int
    requests_per_minute: int
    requests_per_day: int
    monthly_spend_limit: float = 0
    expires_at: str | None = None
    last_used_at: str | None = None
    created_by: str
    created_at: str
    updated_at: str


class PaginatedAPIKeysResponse(BaseModel):
    data: list[APIKeyResponse]
    has_more: bool
    next_cursor: str | None = None


class RotateAPIKeyResponse(BaseModel):
    id: str
    key: str
    key_hint: str
    key_type: str
    name: str
    org_id: str
    created_at: str
    updated_at: str


def _require_org_access(key_info: KeyInfo, org_id: str) -> None:
    if key_info.is_system_admin or has_role(key_info.role, ROLE_SYSTEM_ADMIN):
        return
    if key_info.org_id != org_id:
        raise forbidden()


def _can_manage_all_keys(caller: KeyInfo) -> bool:
    """Org-wide key management: org_admin+ *user/session* callers only (machine keys never manage keys)."""
    return _is_user_caller(caller) and (has_role(caller.role, ROLE_ORG_ADMIN) or caller.is_system_admin)


_USER_OWNED_TYPES = (KEY_TYPE_USER, KEY_TYPE_SESSION)
_LIMIT_FIELDS = (
    "daily_token_limit",
    "monthly_token_limit",
    "requests_per_minute",
    "requests_per_day",
    "monthly_spend_limit",
    "expires_at",
)

# Key-management actions. Rotation returns fresh plaintext, so it is stricter than the rest.
ACTION_READ = "read"
ACTION_UPDATE = "update"
ACTION_DELETE = "delete"
ACTION_ROTATE = "rotate"


def _is_user_caller(caller: KeyInfo) -> bool:
    """True for credentials that represent a human (user or session key with a user_id)."""
    return bool(caller.user_id) and caller.key_type in _USER_OWNED_TYPES


def _caller_rank(caller: KeyInfo) -> int:
    if caller.is_system_admin:
        return ROLE_RANK[ROLE_SYSTEM_ADMIN]
    return ROLE_RANK.get(caller.role, -1)


def _is_self_key(key: dict[str, Any], caller: KeyInfo) -> bool:
    return (
        _is_user_caller(caller)
        and key.get("key_type") in _USER_OWNED_TYPES
        and bool(key.get("user_id"))
        and key.get("user_id") == caller.user_id
    )


async def _user_rank_in_org(db: Any, user_id: str, org_id: str, cache: dict[str, int] | None = None) -> int | None:
    """Effective rank of a user within org_id (system admin -> top rank); None if not a member."""
    if cache is not None and user_id in cache:
        return cache[user_id]
    rank: int | None
    user = await repo.get_user(db, user_id)
    if not user:
        rank = None
    elif user.get("is_system_admin"):
        rank = ROLE_RANK[ROLE_SYSTEM_ADMIN]
    else:
        try:
            rank = ROLE_RANK.get(await repo.get_user_org_role(db, user_id, org_id), ROLE_RANK[ROLE_MEMBER])
        except repo.NotFoundError:
            rank = None
    if cache is not None:
        cache[user_id] = rank  # type: ignore[assignment]
    return rank


async def _owner_rank(db: Any, key: dict[str, Any], cache: dict[str, int] | None = None) -> int:
    """Effective role rank the key would carry when used (mirrors handler.resolve_key_role)."""
    if key.get("key_type") in _USER_OWNED_TYPES:
        uid = key.get("user_id")
        if not uid:
            return ROLE_RANK[ROLE_MEMBER]
        rank = await _user_rank_in_org(db, uid, key["org_id"], cache)
        # Owner gone / not a member: the key cannot authenticate (load_active_keys drops it).
        return ROLE_RANK[ROLE_MEMBER] if rank is None else rank
    return ROLE_RANK.get(resolve_key_role(key), ROLE_RANK[ROLE_MEMBER])


async def _can_manage_key(
    db: Any,
    key: dict[str, Any],
    caller: KeyInfo,
    action: str = ACTION_READ,
    cache: dict[str, int] | None = None,
) -> bool:
    """Authorize `caller` to perform `action` on `key` (already known to belong to the org)."""
    # Machine credentials (team_key / sa_key) never manage other keys; they may read themselves.
    if not _is_user_caller(caller):
        return action == ACTION_READ and key.get("id") == caller.id
    if _is_self_key(key, caller):
        return True
    if caller.is_system_admin or has_role(caller.role, ROLE_SYSTEM_ADMIN):
        return True
    my_rank = _caller_rank(caller)
    if my_rank < ROLE_RANK[ROLE_TEAM_ADMIN]:
        return False
    if my_rank < ROLE_RANK[ROLE_ORG_ADMIN]:
        # team_admin: only keys bound to a team the caller really belongs to.
        team_id = key.get("team_id")
        if not team_id or not await repo.is_team_member(db, caller.user_id, team_id):
            return False
    owner_rank = await _owner_rank(db, key, cache)
    if owner_rank > my_rank:
        return False
    if action == ACTION_ROTATE and key.get("key_type") in _USER_OWNED_TYPES and owner_rank >= my_rank:
        # Rotation hands back plaintext: never let a caller mint a credential for a peer or superior.
        return False
    return True


async def _validate_user_key_target(db: Any, org_id: str, req: dict[str, Any], caller: KeyInfo) -> None:
    """Validate (in place) owner/team/sa binding for a new user_key."""
    target_user_id = req.get("user_id")
    if not target_user_id:
        raise bad_request("user_id is required for user_key")
    if req.get("service_account_id"):
        raise bad_request("service_account_id is not allowed for user_key")
    owner = await repo.get_user(db, target_user_id)
    if not owner:
        raise bad_request("user not found")
    caller_is_sysadmin = caller.is_system_admin or has_role(caller.role, ROLE_SYSTEM_ADMIN)
    if owner.get("is_system_admin") and not caller_is_sysadmin:
        # A key owned by a system admin authenticates as system_admin.
        raise forbidden("cannot create keys for a system administrator")
    if owner.get("is_system_admin") and caller_is_sysadmin:
        target_rank: int | None = ROLE_RANK[ROLE_SYSTEM_ADMIN]
    else:
        target_rank = await _user_rank_in_org(db, target_user_id, org_id)
        if target_rank is None:
            raise bad_request("user is not a member of this organization")
    if target_user_id != caller.user_id and target_rank > _caller_rank(caller):
        raise forbidden("cannot create keys for a user with a higher role")
    team_id = req.get("team_id")
    if team_id:
        team = await repo.get_team(db, team_id)
        if not team or team["org_id"] != org_id:
            raise bad_request("team not found")
        if not await repo.is_team_member(db, target_user_id, team_id):
            raise bad_request("user is not a member of this team")


def _field_changed(field: str, new: Any, old: Any) -> bool:
    """True when a PATCH value differs from the stored one (the UI re-sends unchanged values)."""
    if field == "expires_at":
        return parse_key_expiry(new) != parse_key_expiry(old)
    if field == "monthly_spend_limit":
        return float(new or 0) != float(old or 0)
    return int(new or 0) != int(old or 0)


def _key_resp(k: dict[str, Any]) -> APIKeyResponse:
    return APIKeyResponse(
        id=k["id"],
        key_hint=k["key_hint"],
        key_type=k["key_type"],
        name=k["name"],
        org_id=k["org_id"],
        team_id=k.get("team_id"),
        user_id=k.get("user_id"),
        service_account_id=k.get("service_account_id"),
        daily_token_limit=int(k.get("daily_token_limit") or 0),
        monthly_token_limit=int(k.get("monthly_token_limit") or 0),
        requests_per_minute=int(k.get("requests_per_minute") or 0),
        requests_per_day=int(k.get("requests_per_day") or 0),
        monthly_spend_limit=float(k.get("monthly_spend_limit") or 0),
        expires_at=k.get("expires_at"),
        last_used_at=k.get("last_used_at"),
        created_by=k["created_by"],
        created_at=k["created_at"],
        updated_at=k["updated_at"],
    )


@router.post("/orgs/{org_id}/keys", response_model=CreateAPIKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    org_id: str,
    body: CreateAPIKeyRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> CreateAPIKeyResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    if not _is_user_caller(key_info):
        raise bad_request("keys can only be created by user keys")
    if not body.name:
        raise bad_request("name is required")
    if body.key_type not in VALID_KEY_TYPES:
        raise bad_request("key_type must be one of: user_key, team_key, sa_key")
    req = body.model_dump()
    if not _can_manage_all_keys(key_info):
        if body.key_type != KEY_TYPE_USER:
            raise forbidden("you can only create user keys")
        req["user_id"] = key_info.user_id
    if body.key_type == KEY_TYPE_USER:
        await _validate_user_key_target(h.db, org_id, req, key_info)
    elif body.key_type == KEY_TYPE_TEAM:
        if not body.team_id:
            raise bad_request("team_id is required for team_key")
        team = await repo.get_team(h.db, body.team_id)
        if not team or team["org_id"] != org_id:
            raise bad_request("team not found")
        req["user_id"] = None
        req["service_account_id"] = None
    elif body.key_type == KEY_TYPE_SA:
        if not body.service_account_id:
            raise bad_request("service_account_id is required for sa_key")
        sa = await repo.get_service_account(h.db, body.service_account_id)
        if not sa or sa["org_id"] != org_id:
            raise bad_request("service account not found")
        if body.team_id and body.team_id != sa.get("team_id"):
            raise bad_request("team_id must match the service account's team")
        req["user_id"] = None
    if body.expires_at is not None and parse_key_expiry(body.expires_at) is None:
        raise bad_request("expires_at must be an ISO-8601 timestamp")
    plaintext = generate_key(body.key_type)
    key_hash = hash_key(plaintext, h.hmac_secret)
    api_key = await repo.create_api_key(
        h.db,
        {
            "key_hash": key_hash,
            "key_hint": hint_key(plaintext),
            "key_type": body.key_type,
            "name": body.name,
            "org_id": org_id,
            "team_id": req.get("team_id"),
            "user_id": req.get("user_id"),
            "service_account_id": req.get("service_account_id"),
            "daily_token_limit": body.daily_token_limit,
            "monthly_token_limit": body.monthly_token_limit,
            "requests_per_minute": body.requests_per_minute,
            "requests_per_day": body.requests_per_day,
            "monthly_spend_limit": body.monthly_spend_limit,
            "expires_at": body.expires_at,
            "created_by": key_info.user_id,
        },
    )
    # Load the cache entry from the DB so key/team/org limits, spend caps, expiry and
    # guardrail flags apply immediately (same shape as seed_key_cache).
    await h.refresh_keys(key_id=api_key["id"])
    return CreateAPIKeyResponse(
        id=api_key["id"],
        key=plaintext,
        key_hint=api_key["key_hint"],
        key_type=api_key["key_type"],
        name=api_key["name"],
        org_id=api_key["org_id"],
        team_id=api_key.get("team_id"),
        user_id=api_key.get("user_id"),
        service_account_id=api_key.get("service_account_id"),
        daily_token_limit=int(api_key.get("daily_token_limit") or 0),
        monthly_token_limit=int(api_key.get("monthly_token_limit") or 0),
        requests_per_minute=int(api_key.get("requests_per_minute") or 0),
        requests_per_day=int(api_key.get("requests_per_day") or 0),
        monthly_spend_limit=float(api_key.get("monthly_spend_limit") or 0),
        expires_at=api_key.get("expires_at"),
        created_by=api_key["created_by"],
        created_at=api_key["created_at"],
        updated_at=api_key["updated_at"],
    )


@router.get("/orgs/{org_id}/keys", response_model=PaginatedAPIKeysResponse)
async def list_api_keys(
    org_id: str,
    limit: int | None = Query(20),
    cursor: str | None = Query(None),
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> PaginatedAPIKeysResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    p = parse_pagination(limit, cursor)
    raw = await repo.list_api_keys(h.db, org_id, p.cursor, p.limit + 1, False)
    # Paginate on the raw page (so the cursor never skips keys), then filter by visibility.
    has_more = len(raw) > p.limit
    if has_more:
        raw = raw[: p.limit]
    rank_cache: dict[str, int] = {}
    keys = [k for k in raw if await _can_manage_key(h.db, k, key_info, ACTION_READ, rank_cache)]
    return PaginatedAPIKeysResponse(
        data=[_key_resp(k) for k in keys],
        has_more=has_more,
        next_cursor=raw[-1]["id"] if has_more and raw else None,
    )


@router.get("/orgs/{org_id}/keys/{key_id}", response_model=APIKeyResponse)
async def get_api_key(
    org_id: str,
    key_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> APIKeyResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    key = await repo.get_api_key(h.db, key_id)
    if not key or key["org_id"] != org_id:
        raise not_found("api key not found")
    if not await _can_manage_key(h.db, key, key_info, ACTION_READ):
        raise not_found("api key not found")
    return _key_resp(key)


@router.patch("/orgs/{org_id}/keys/{key_id}", response_model=APIKeyResponse)
async def update_api_key(
    org_id: str,
    key_id: str,
    body: UpdateAPIKeyRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> APIKeyResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    existing = await repo.get_api_key(h.db, key_id)
    if not existing or existing["org_id"] != org_id:
        raise not_found("api key not found")
    if not await _can_manage_key(h.db, existing, key_info, ACTION_UPDATE):
        raise not_found("api key not found")
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if fields.get("expires_at") is not None and parse_key_expiry(fields["expires_at"]) is None:
        raise bad_request("expires_at must be an ISO-8601 timestamp")
    if not _can_manage_all_keys(key_info):
        changed = [f for f in _LIMIT_FIELDS if f in fields and _field_changed(f, fields[f], existing.get(f))]
        if changed:
            raise forbidden("only organization admins can change key limits or expiry")
    try:
        key = await repo.update_api_key(h.db, key_id, fields)
    except repo.NotFoundError:
        raise not_found("api key not found")
    except Exception:
        raise internal_error("failed to update api key")
    await h.refresh_keys(key_id=key_id)
    return _key_resp(key)


@router.delete("/orgs/{org_id}/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(
    org_id: str,
    key_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> Response:
    h = get_handler()
    _require_org_access(key_info, org_id)
    existing = await repo.get_api_key(h.db, key_id)
    if not existing or existing["org_id"] != org_id:
        raise not_found("api key not found")
    if not await _can_manage_key(h.db, existing, key_info, ACTION_DELETE):
        raise not_found("api key not found")
    try:
        await repo.delete_api_key(h.db, key_id)
    except repo.NotFoundError:
        raise not_found("api key not found")
    except Exception:
        raise internal_error("failed to delete api key")
    key_hash = existing.get("key_hash")
    if key_hash:
        h.key_cache.delete(key_hash)
    h.key_cache.evict(key_id=key_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/orgs/{org_id}/keys/{key_id}/rotate", response_model=RotateAPIKeyResponse)
async def rotate_api_key(
    org_id: str,
    key_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> RotateAPIKeyResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    existing = await repo.get_api_key(h.db, key_id)
    if not existing or existing["org_id"] != org_id:
        raise not_found("api key not found")
    if not await _can_manage_key(h.db, existing, key_info, ACTION_ROTATE):
        raise not_found("api key not found")
    if existing["key_type"] in (KEY_TYPE_SESSION,):
        raise bad_request("session keys cannot be rotated")
    old_hash = existing.get("key_hash")
    plaintext = generate_key(existing["key_type"])
    key_hash = hash_key(plaintext, h.hmac_secret)
    try:
        key = await repo.update_api_key(
            h.db,
            key_id,
            {"key_hash": key_hash, "key_hint": hint_key(plaintext)},
        )
    except repo.NotFoundError:
        raise not_found("api key not found")
    except Exception:
        raise internal_error("failed to rotate api key")
    if old_hash:
        h.key_cache.delete(old_hash)
    # Evicts any entry for this key id (old hash) and loads the new hash with full limits.
    await h.refresh_keys(key_id=key_id)
    return RotateAPIKeyResponse(
        id=key["id"],
        key=plaintext,
        key_hint=key["key_hint"],
        key_type=key["key_type"],
        name=key["name"],
        org_id=key["org_id"],
        created_at=key["created_at"],
        updated_at=key["updated_at"],
    )
