"""Admin API Handler with shared dependencies."""

from __future__ import annotations

import asyncio

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

from fastapi import Depends, Request

from wai.api.admin.common import (
    KEY_INFO_CTX,
    KEY_TYPE_SA,
    KEY_TYPE_SESSION,
    KEY_TYPE_TEAM,
    KEY_TYPE_USER,
    KeyInfo,
    ROLE_MEMBER,
    ROLE_ORG_ADMIN,
    ROLE_SYSTEM_ADMIN,
    ROLE_TEAM_ADMIN,
    derive_hmac_secret,
    get_key_info,
    has_role,
    hash_key,
    load_encryption_key,
    unauthorized,
)
from wai.api.admin import repository as repo
from wai.db.connection import Database
from wai.proxy.access import ModelAccessCache, reload_access_cache


@dataclass
class SSOConfig:
    enabled: bool = False
    issuer: str = ""
    client_id: str = ""
    client_secret: str = ""
    redirect_url: str = ""
    scopes: list[str] = field(default_factory=list)
    allowed_domains: list[str] = field(default_factory=list)
    auto_provision: bool = False
    default_role: str = "member"
    default_org_slug: str = ""
    group_sync: bool = False
    group_claim: str = ""


@dataclass
class ModelRegistry:
    """Minimal model registry for access checks."""

    _models: dict[str, dict[str, Any]] = field(default_factory=dict)

    def list_info(self) -> list[dict[str, str]]:
        return [{"name": n, "type": m.get("type", "chat")} for n, m in self._models.items()]

    def resolve(self, name: str) -> dict[str, Any]:
        if name not in self._models:
            raise KeyError(name)
        return self._models[name]

    def reload(self, models: list[dict[str, Any]]) -> None:
        self._models = {m["name"]: m for m in models}


# Session keys are allowed on /v1/* so the admin Playground can use the login token.
PROXY_KEY_TYPES = frozenset({KEY_TYPE_USER, KEY_TYPE_TEAM, KEY_TYPE_SA, KEY_TYPE_SESSION})


def parse_key_expiry(value: Any) -> datetime | None:
    """Parse an api_keys.expires_at value (TEXT or datetime). Naive values are treated as UTC."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def is_key_expired(info: KeyInfo, now: datetime | None = None) -> bool:
    if info.expires_at is None:
        return False
    exp = info.expires_at if info.expires_at.tzinfo else info.expires_at.replace(tzinfo=timezone.utc)
    return (now or datetime.now(timezone.utc)) >= exp


def resolve_key_role(r: dict[str, Any]) -> str:
    ktype = r["key_type"]
    if ktype in (KEY_TYPE_USER, KEY_TYPE_SESSION):
        if r.get("is_system_admin"):
            return ROLE_SYSTEM_ADMIN
        if r.get("membership_role"):
            return r["membership_role"]
        return ROLE_MEMBER
    if ktype == KEY_TYPE_TEAM:
        return ROLE_TEAM_ADMIN
    if ktype == KEY_TYPE_SA:
        return ROLE_TEAM_ADMIN if r.get("team_id") else ROLE_ORG_ADMIN
    return ROLE_MEMBER


def key_info_from_row(r: dict[str, Any]) -> KeyInfo:
    """Build a cache entry from a repo.load_active_keys row (key + org/team limits + role context)."""
    return KeyInfo(
        id=r["id"],
        key_type=r["key_type"],
        role=resolve_key_role(r),
        org_id=r["org_id"],
        team_id=r.get("team_id") or "",
        user_id=r.get("user_id") or "",
        service_account_id=r.get("service_account_id") or "",
        name=r.get("name") or "",
        is_system_admin=bool(r.get("is_system_admin")),
        daily_token_limit=int(r.get("daily_token_limit") or 0),
        monthly_token_limit=int(r.get("monthly_token_limit") or 0),
        requests_per_minute=int(r.get("requests_per_minute") or 0),
        requests_per_day=int(r.get("requests_per_day") or 0),
        expires_at=parse_key_expiry(r.get("expires_at")),
        org_daily_token_limit=int(r.get("org_daily_token_limit") or 0),
        org_monthly_token_limit=int(r.get("org_monthly_token_limit") or 0),
        org_requests_per_minute=int(r.get("org_requests_per_minute") or 0),
        org_requests_per_day=int(r.get("org_requests_per_day") or 0),
        team_daily_token_limit=int(r.get("team_daily_token_limit") or 0),
        team_monthly_token_limit=int(r.get("team_monthly_token_limit") or 0),
        team_requests_per_minute=int(r.get("team_requests_per_minute") or 0),
        team_requests_per_day=int(r.get("team_requests_per_day") or 0),
        monthly_spend_limit=float(r.get("monthly_spend_limit") or 0),
        org_monthly_spend_limit=float(r.get("org_monthly_spend_limit") or 0),
        team_monthly_spend_limit=float(r.get("team_monthly_spend_limit") or 0),
        org_guardrail_pii=bool(int(r.get("org_guardrail_pii") or 0)),
        org_guardrail_tool_denylist=str(r.get("org_guardrail_tool_denylist") or ""),
    )


_SCOPE_ATTRS = {
    "key_id": "id",
    "user_id": "user_id",
    "team_id": "team_id",
    "org_id": "org_id",
    "service_account_id": "service_account_id",
}


def _scope_predicate(scope: dict[str, str | None], key_types: frozenset[str] | None = None) -> Callable[[KeyInfo], bool]:
    active = {_SCOPE_ATTRS[k]: v for k, v in scope.items() if v is not None}
    if not active:
        raise ValueError("at least one scope filter is required")

    def _match(info: KeyInfo) -> bool:
        if key_types is not None and info.key_type not in key_types:
            return False
        return all(getattr(info, attr) == val for attr, val in active.items())

    return _match


class KeyCache:
    def __init__(self) -> None:
        self._entries: dict[str, KeyInfo] = {}

    def get(self, key_hash: str) -> KeyInfo | None:
        info = self._entries.get(key_hash)
        if info is not None and is_key_expired(info):
            self._entries.pop(key_hash, None)
            return None
        return info

    def set(self, key_hash: str, info: KeyInfo) -> None:
        self._entries[key_hash] = info

    def delete(self, key_hash: str) -> None:
        self._entries.pop(key_hash, None)

    def load_all(self, entries: dict[str, KeyInfo]) -> None:
        self._entries = entries

    def __len__(self) -> int:
        return len(self._entries)

    def evict_where(self, pred: Callable[[KeyInfo], bool]) -> int:
        doomed = [kh for kh, info in self._entries.items() if pred(info)]
        for kh in doomed:
            self._entries.pop(kh, None)
        return len(doomed)

    def replace_where(self, pred: Callable[[KeyInfo], bool], entries: dict[str, KeyInfo]) -> None:
        """Atomically (no awaits) drop entries matching pred and install fresh ones."""
        self.evict_where(pred)
        self._entries.update(entries)

    def evict(
        self,
        *,
        key_id: str | None = None,
        user_id: str | None = None,
        team_id: str | None = None,
        org_id: str | None = None,
        service_account_id: str | None = None,
        key_types: frozenset[str] | None = None,
    ) -> int:
        """Evict entries matching all given filters (e.g. user_id + org_id)."""
        scope = {
            "key_id": key_id,
            "user_id": user_id,
            "team_id": team_id,
            "org_id": org_id,
            "service_account_id": service_account_id,
        }
        return self.evict_where(_scope_predicate(scope, key_types))

    def evict_by_user(self, user_id: str, key_types: frozenset[str] | None = None) -> int:
        return self.evict(user_id=user_id, key_types=key_types)

    def evict_by_team(self, team_id: str) -> int:
        return self.evict(team_id=team_id)

    def evict_by_org(self, org_id: str) -> int:
        return self.evict(org_id=org_id)


class Handler:
    """Shared dependencies for all admin API route modules."""

    def __init__(
        self,
        db: Database,
        *,
        log: logging.Logger | None = None,
        encryption_key: bytes | None = None,
        sso_config: SSOConfig | None = None,
        sso_provider: Any = None,
        registry: ModelRegistry | None = None,
        access_cache: ModelAccessCache | None = None,
        mcp_server_cache: Any = None,
        health_checker: Any = None,
        mcp_health_checker: Any = None,
        mcp_server: Any = None,
        code_mode_server: Any = None,
        update_checker: Any = None,
        audit_logger: Any = None,
        rate_limiter: Any = None,
        brute_force: Any = None,
        reload_models: Callable[[], Awaitable[None]] | None = None,
        fallback_max_depth: int = 0,
        mcp_call_timeout: float = 30.0,
        mcp_allow_private_urls: bool = False,
    ) -> None:
        self.db = db
        self.log = log or logging.getLogger("wai.admin")
        self.encryption_key = encryption_key or load_encryption_key()
        self.hmac_secret = derive_hmac_secret(self.encryption_key)
        self.key_cache = KeyCache()
        self.registry = registry or ModelRegistry()
        self.access_cache = access_cache or ModelAccessCache()
        self.mcp_server_cache = mcp_server_cache
        self.sso_config = sso_config or SSOConfig()
        self.sso_provider = sso_provider
        self.health_checker = health_checker
        self.mcp_health_checker = mcp_health_checker
        self.mcp_server = mcp_server
        self.code_mode_server = code_mode_server
        self.update_checker = update_checker
        self.audit_logger = audit_logger
        self.rate_limiter = rate_limiter
        self.brute_force = brute_force
        self.reload_models = reload_models
        self.fallback_max_depth = fallback_max_depth
        self.mcp_call_timeout = mcp_call_timeout
        self.mcp_allow_private_urls = mcp_allow_private_urls
        self._refresh_tasks: set[asyncio.Task] = set()
        self._fallback_lock = False
        self._mcp_client: Any = None

    async def seed_key_cache(self) -> None:
        records = await repo.load_all_active_keys(self.db)
        entries = {r["key_hash"]: key_info_from_row(r) for r in records}
        self.key_cache.load_all(entries)

    async def refresh_keys(
        self,
        *,
        key_id: str | None = None,
        user_id: str | None = None,
        team_id: str | None = None,
        org_id: str | None = None,
        service_account_id: str | None = None,
    ) -> int:
        """Reload cache entries in a scope from the DB (filters combine with AND).

        Entries in the scope that are no longer active (deleted/revoked/owner removed) are
        evicted; the rest are replaced with fresh limits/role. If the DB read fails twice the
        scope is evicted (fail closed), the error is logged, and a background retry restores
        it once the DB is reachable again. Returns entries loaded.
        """
        scope = {
            "key_id": key_id,
            "user_id": user_id,
            "team_id": team_id,
            "org_id": org_id,
            "service_account_id": service_account_id,
        }
        pred = _scope_predicate(scope)
        rows = None
        for attempt in range(2):
            try:
                rows = await repo.load_active_keys(self.db, **scope)
                break
            except Exception as exc:
                if attempt == 0:
                    await asyncio.sleep(0.2)
                    continue
                self.log.error("key cache refresh failed for %s: %s; evicting scope", scope, exc)
                self.key_cache.evict_where(pred)
                self._schedule_refresh_retry(scope)
                return 0
        entries = {r["key_hash"]: key_info_from_row(r) for r in rows or []}
        self.key_cache.replace_where(pred, entries)
        return len(entries)

    def _schedule_refresh_retry(self, scope: dict[str, str | None]) -> None:
        async def _retry() -> None:
            for delay in (2, 10, 30, 60, 300):
                await asyncio.sleep(delay)
                try:
                    rows = await repo.load_active_keys(self.db, **scope)
                except Exception:
                    continue
                entries = {r["key_hash"]: key_info_from_row(r) for r in rows}
                self.key_cache.replace_where(_scope_predicate(scope), entries)
                self.log.info("key cache scope %s restored (%d keys)", scope, len(entries))
                return
            self.log.error("key cache scope %s could not be restored; restart may be required", scope)

        try:
            task = asyncio.get_running_loop().create_task(_retry())
        except RuntimeError:
            return
        self._refresh_tasks.add(task)
        task.add_done_callback(self._refresh_tasks.discard)

    async def revoke_user_sessions(self, user_id: str) -> None:
        """Soft-delete a user's session keys in the DB and drop them from the cache."""
        await repo.revoke_user_sessions(self.db, user_id)
        self.key_cache.evict_by_user(user_id, frozenset({KEY_TYPE_SESSION}))

    @staticmethod
    def _resolve_role(r: dict[str, Any]) -> str:
        return resolve_key_role(r)

    async def refresh_access_cache(self) -> None:
        await reload_access_cache(self.db, self.access_cache)


_handler: Handler | None = None


def init_handler(db: Database, **kwargs: Any) -> Handler:
    global _handler
    _handler = Handler(db, **kwargs)
    return _handler


def get_handler() -> Handler:
    if _handler is None:
        raise RuntimeError("handler not initialized")
    return _handler


async def authenticate_bearer(request: Request, *, proxy: bool = False) -> KeyInfo:
    """Validate Bearer token and return KeyInfo. Used by admin and proxy auth."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.startswith("Bearer ") else ""
    if not token:
        raise unauthorized("missing authorization header")
    h = get_handler()
    from wai.api.admin.common import validate_prefix

    try:
        validate_prefix(token)
    except ValueError as exc:
        raise unauthorized("invalid API key format") from exc
    kh = hash_key(token, h.hmac_secret)
    info = h.key_cache.get(kh)
    if info is None:
        raise unauthorized("invalid API key")
    if is_key_expired(info):
        h.key_cache.delete(kh)
        raise unauthorized("invalid API key")
    if proxy and info.key_type not in PROXY_KEY_TYPES:
        raise unauthorized("invalid API key")
    request.state.__dict__[KEY_INFO_CTX] = info
    return info


async def auth_middleware(request: Request) -> KeyInfo:
    """Bearer token authentication — stores KeyInfo on request.state."""
    return await authenticate_bearer(request)


def require_role(required: str):
    async def _dep(key_info: KeyInfo = Depends(auth_middleware)) -> KeyInfo:
        from wai.api.admin.common import KEY_TYPE_SA, forbidden

        # Service-account keys are machine credentials for /v1 and the MCP gateway only;
        # they get no admin API access regardless of their derived role.
        if key_info.key_type == KEY_TYPE_SA:
            raise forbidden("service account keys cannot use the admin API")
        if not has_role(key_info.role, required):
            raise forbidden()
        return key_info

    return _dep


async def optional_auth(request: Request) -> KeyInfo | None:
    from fastapi import HTTPException

    try:
        return await auth_middleware(request)
    except HTTPException:
        return None
