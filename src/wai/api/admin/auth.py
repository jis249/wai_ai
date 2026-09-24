"""Authentication handlers: login, providers, profile."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from wai.api.admin.common import (
    KEY_TYPE_SESSION,
    KeyInfo,
    ROLE_MEMBER,
    ROLE_ORG_ADMIN,
    bad_request,
    generate_key,
    get_key_info,
    hash_key,
    hint_key,
    internal_error,
    unauthorized,
    user_key_name,
)
from wai.audit.logger import AuditEvent
from wai.api.admin.handler import auth_middleware, get_handler
from wai.api.admin import repository as repo
from wai.net.client_ip import client_ip

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


class MeResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    org_id: str | None = None
    is_system_admin: bool


class LoginResponse(BaseModel):
    token: str
    expires_at: str
    user: MeResponse


class AvailableModel(BaseModel):
    name: str
    type: str = "chat"


class AvailableModelsResponse(BaseModel):
    models: list[AvailableModel]


_DUMMY_HASH = bcrypt.hashpw(b"wa-dummy-timing-pad", bcrypt.gensalt())


def _log_auth_audit(
    h,
    request: Request,
    *,
    action: str,
    email: str,
    status_code: int,
    org_id: str = "",
    actor_id: str = "",
    method: str = "local",
    detail: str = "",
) -> None:
    if h.audit_logger is None:
        return
    description = detail or f"email={email} method={method}"
    h.audit_logger.log(
        AuditEvent(
            request_id=getattr(request.state, "request_id", "") or "",
            org_id=org_id,
            actor_id=actor_id,
            actor_type="user" if actor_id else "anonymous",
            action=action,
            resource_type="auth",
            resource_id=actor_id or email,
            description=description,
            ip_address=client_ip(request),
            status_code=status_code,
        )
    )


async def _cache_session_key(h, key_id: str, key_hash: str) -> KeyInfo:
    """Load a freshly created session key into the cache with org limits, spend caps and guardrails."""
    await h.refresh_keys(key_id=key_id)
    info = h.key_cache.get(key_hash)
    if info is None:
        raise internal_error("failed to establish session")
    return info


@router.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request) -> LoginResponse:
    h = get_handler()
    ip = client_ip(request)
    if h.brute_force is not None:
        await h.brute_force.check_allowed(ip, "login")
    if not body.email:
        raise bad_request("email is required")
    if not body.password:
        raise bad_request("password is required")
    try:
        user_id, pw_hash = await repo.get_user_password_hash(h.db, body.email)
    except repo.NotFoundError:
        bcrypt.checkpw(body.password.encode(), _DUMMY_HASH)
        if h.brute_force is not None:
            await h.brute_force.record_failure(ip, "login")
        _log_auth_audit(
            h, request, action="auth.login_failed", email=body.email,
            status_code=401, detail=f"login failed: unknown email email={body.email} method=local",
        )
        raise unauthorized("invalid email or password")
    except Exception:
        raise internal_error("authentication failed")
    if not bcrypt.checkpw(body.password.encode(), pw_hash.encode()):
        if h.brute_force is not None:
            await h.brute_force.record_failure(ip, "login")
        _log_auth_audit(
            h, request, action="auth.login_failed", email=body.email,
            actor_id=user_id, status_code=401,
            detail=f"login failed: invalid password email={body.email} method=local",
        )
        raise unauthorized("invalid email or password")
    try:
        role, org_id = await repo.resolve_user_role(h.db, user_id)
    except repo.NotFoundError:
        raise unauthorized("user has no organization membership")
    user = await repo.get_user(h.db, user_id)
    assert user
    session_key_name = user_key_name(user["display_name"])
    await h.revoke_user_sessions(user_id)
    key = generate_key(KEY_TYPE_SESSION)
    key_hash = hash_key(key, h.hmac_secret)
    key_hint = hint_key(key)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    expires_at_str = expires_at.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    api_key = await repo.create_api_key(
        h.db,
        {
            "key_hash": key_hash,
            "key_hint": key_hint,
            "key_type": KEY_TYPE_SESSION,
            "name": session_key_name,
            "org_id": org_id,
            "user_id": user_id,
            "expires_at": expires_at_str,
            "created_by": user_id,
        },
    )
    await _cache_session_key(h, api_key["id"], key_hash)
    if h.brute_force is not None:
        await h.brute_force.clear(ip, "login")
    _log_auth_audit(
        h, request, action="auth.login", email=body.email, org_id=org_id,
        actor_id=user_id, status_code=200, method="local",
        detail=f"login success email={body.email} method=local",
    )
    return LoginResponse(
        token=key,
        expires_at=expires_at_str,
        user=MeResponse(
            id=user["id"],
            email=user["email"],
            display_name=user["display_name"],
            role=role,
            org_id=org_id or None,
            is_system_admin=user["is_system_admin"],
        ),
    )


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, key_info: KeyInfo = Depends(auth_middleware)) -> Response:
    """Revoke the caller's session token (DB soft-delete + cache eviction)."""
    h = get_handler()
    if key_info.key_type != KEY_TYPE_SESSION:
        raise bad_request("logout requires a session token; revoke API keys via the keys API")
    try:
        await repo.delete_api_key(h.db, key_info.id)
    except repo.NotFoundError:
        pass
    except Exception:
        raise internal_error("failed to log out")
    h.key_cache.evict(key_id=key_info.id)
    user = await repo.get_user(h.db, key_info.user_id) if key_info.user_id else None
    _log_auth_audit(
        h, request, action="auth.logout", email=(user or {}).get("email", ""), org_id=key_info.org_id,
        actor_id=key_info.user_id, status_code=204, method="session",
        detail="logout",
    )
    return Response(status_code=204)


@router.get("/me", response_model=MeResponse)
async def me(key_info: KeyInfo = Depends(auth_middleware)) -> MeResponse:
    h = get_handler()
    if not key_info.user_id:
        raise bad_request("this endpoint requires a user-scoped key")
    user = await repo.get_user(h.db, key_info.user_id)
    if not user:
        from wai.api.admin.common import not_found
        raise not_found("user not found")
    return MeResponse(
        id=user["id"],
        email=user["email"],
        display_name=user["display_name"],
        role=key_info.role,
        org_id=key_info.org_id or None,
        is_system_admin=user["is_system_admin"],
    )


@router.get("/me/available-models", response_model=AvailableModelsResponse)
async def available_models(key_info: KeyInfo = Depends(auth_middleware)) -> AvailableModelsResponse:
    h = get_handler()
    models = []
    has_chat = False
    for m in h.registry.list_info():
        if h.access_cache.check(key_info.org_id, key_info.team_id, key_info.id, m["name"]):
            mtype = m.get("type") or "chat"
            if mtype in ("chat", "completion"):
                has_chat = True
            models.append(AvailableModel(name=m["name"], type=mtype))
    if has_chat:
        models.insert(0, AvailableModel(name="auto", type="chat"))
    return AvailableModelsResponse(models=models)


# --- Auth providers & OIDC ---

@router.get("/auth/providers")
async def auth_providers() -> dict[str, bool]:
    h = get_handler()
    return {"local": True, "oidc": h.sso_provider is not None}


@router.get("/auth/oidc/login")
async def oidc_login(request: Request) -> RedirectResponse:
    import secrets

    h = get_handler()
    if h.sso_provider is None:
        raise internal_error("SSO not configured")
    state = secrets.token_hex(32)
    nonce = secrets.token_hex(32)
    secure = h.sso_config.redirect_url.startswith("https://")
    response = RedirectResponse(url=h.sso_provider.auth_url(state, nonce), status_code=302)
    response.set_cookie(
        "wai_oidc_state", f"{state}|{nonce}", max_age=300, httponly=True, samesite="lax", secure=secure, path="/"
    )
    return response


_OIDC_PROVISION_ROLES = {ROLE_MEMBER, ROLE_ORG_ADMIN}


def _claim_is_true(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False


def _oidc_identity_denial(sso_config, claims) -> str:
    """Return a /login error code if the IdP identity may not sign in, else ''.

    Enforces sso.allowed_domains (case-insensitive email-domain match; empty list = any domain)
    and rejects identities whose email_verified claim is present but not true.
    """
    email = (getattr(claims, "email", "") or "").strip()
    email_verified = getattr(claims, "email_verified", None)
    if email_verified is None:
        raw = getattr(claims, "raw", None)
        if isinstance(raw, dict):
            email_verified = raw.get("email_verified")
    if email_verified is not None and not _claim_is_true(email_verified):
        return "email_not_verified"
    allowed = {d.strip().lstrip("@").lower() for d in (sso_config.allowed_domains or []) if d and d.strip()}
    if allowed:
        if "@" not in email:
            return "domain_not_allowed"
        domain = email.rsplit("@", 1)[1].lower()
        if domain not in allowed:
            return "domain_not_allowed"
    return ""


@router.get("/auth/oidc/callback")
async def oidc_callback(request: Request, code: str = "", state: str = "") -> RedirectResponse:
    h = get_handler()
    if h.sso_provider is None:
        return RedirectResponse("/login?error=sso_disabled")
    secure = h.sso_config.redirect_url.startswith("https://")
    raw_cookie = request.cookies.get("wai_oidc_state", "")
    parts = raw_cookie.split("|", 1)
    cookie_state = parts[0]
    cookie_nonce = parts[1] if len(parts) == 2 else ""
    if not cookie_state or cookie_state != state:
        return RedirectResponse("/login?error=invalid_state")
    response = RedirectResponse("/auth/callback", status_code=302)
    response.delete_cookie("wai_oidc_state", path="/")
    if not code:
        return RedirectResponse("/login?error=missing_code")
    try:
        claims = await h.sso_provider.exchange(code, cookie_nonce)
    except Exception:
        return RedirectResponse("/login?error=exchange_failed")
    denial = _oidc_identity_denial(h.sso_config, claims)
    if denial:
        return RedirectResponse(f"/login?error={denial}")
    user = await repo.get_user_by_external_id(h.db, "oidc", claims.subject)
    if user is None:
        if not h.sso_config.auto_provision:
            return RedirectResponse("/login?error=not_provisioned")
        slug = (h.sso_config.default_org_slug or "").strip()
        org = await repo.get_org_by_slug(h.db, slug) if slug else None
        if org is None:
            # Never guess a tenant: provisioning requires an explicit, existing sso.default_org_slug.
            return RedirectResponse("/login?error=provision_no_default_org")
        default_role = h.sso_config.default_role if h.sso_config.default_role in _OIDC_PROVISION_ROLES else ROLE_MEMBER
        user = await repo.create_user(
            h.db, email=claims.email, display_name=claims.name or claims.email,
            password_hash=None, auth_provider="oidc", external_id=claims.subject,
        )
        await repo.create_org_membership(h.db, org["id"], user["id"], default_role)
    try:
        _, session_org_id = await repo.resolve_user_role(h.db, user["id"])
    except repo.NotFoundError:
        return RedirectResponse("/login?error=not_provisioned")
    session_key_name = user_key_name(user["display_name"])
    await h.revoke_user_sessions(user["id"])
    key = generate_key(KEY_TYPE_SESSION)
    key_hash = hash_key(key, h.hmac_secret)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    expires_at_str = expires_at.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    api_key = await repo.create_api_key(
        h.db,
        {
            "key_hash": key_hash, "key_hint": hint_key(key), "key_type": KEY_TYPE_SESSION,
            "name": session_key_name, "org_id": session_org_id, "user_id": user["id"],
            "expires_at": expires_at_str, "created_by": user["id"],
        },
    )
    try:
        await _cache_session_key(h, api_key["id"], key_hash)
    except HTTPException:
        return RedirectResponse("/login?error=provision_failed")
    response.set_cookie(
        "wai_oidc_token", key, max_age=10, httponly=True, samesite="strict", secure=secure, path="/auth/callback"
    )
    return response


@router.post("/auth/oidc/exchange", response_model=LoginResponse)
async def oidc_exchange(request: Request, response: Response) -> LoginResponse:
    """Exchange HttpOnly OIDC session cookie for a bearer token (one-time)."""
    from wai.api.admin.common import validate_prefix

    h = get_handler()
    key = request.cookies.get("wai_oidc_token", "")
    if not key:
        raise unauthorized("SSO session expired")
    try:
        validate_prefix(key)
    except ValueError as exc:
        raise unauthorized("invalid session") from exc
    kh = hash_key(key, h.hmac_secret)
    info = h.key_cache.get(kh)
    if info is None or info.key_type != KEY_TYPE_SESSION:
        raise unauthorized("invalid session")
    if info.expires_at and datetime.now(info.expires_at.tzinfo or None) > info.expires_at:
        h.key_cache.delete(kh)
        raise unauthorized("session expired")
    if not info.user_id:
        raise unauthorized("invalid session")
    user = await repo.get_user(h.db, info.user_id)
    if not user:
        raise unauthorized("invalid session")
    response.delete_cookie("wai_oidc_token", path="/auth/callback")
    expires_at_str = info.expires_at.strftime("%Y-%m-%dT%H:%M:%S+00:00") if info.expires_at else ""
    _log_auth_audit(
        h, request, action="auth.login", email=user["email"], org_id=info.org_id,
        actor_id=user["id"], status_code=200, method="oidc",
        detail=f"login success email={user['email']} method=oidc",
    )
    return LoginResponse(
        token=key,
        expires_at=expires_at_str,
        user=MeResponse(
            id=user["id"],
            email=user["email"],
            display_name=user["display_name"],
            role=info.role,
            org_id=info.org_id or None,
            is_system_admin=user["is_system_admin"],
        ),
    )
