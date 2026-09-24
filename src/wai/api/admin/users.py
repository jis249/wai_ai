"""User CRUD handlers."""

from __future__ import annotations

from typing import Any

import bcrypt
from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel

from wai.api.admin.common import (
    KeyInfo,
    ROLE_MEMBER,
    ROLE_ORG_ADMIN,
    ROLE_RANK,
    ROLE_SYSTEM_ADMIN,
    api_error,
    bad_request,
    conflict,
    forbidden,
    has_role,
    internal_error,
    not_found,
    parse_pagination,
)
from wai.api.admin.handler import auth_middleware, get_handler, require_role
from wai.api.admin import repository as repo

router = APIRouter()


class CreateUserRequest(BaseModel):
    email: str
    display_name: str
    password: str
    is_system_admin: bool = False


class UpdateUserRequest(BaseModel):
    email: str | None = None
    display_name: str | None = None
    password: str | None = None
    # Self-service password change (ProfilePage sends current_password + new_password).
    current_password: str | None = None
    new_password: str | None = None
    is_system_admin: bool | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    auth_provider: str
    is_system_admin: bool
    created_at: str
    updated_at: str
    deleted_at: str | None = None


class PaginatedUsersResponse(BaseModel):
    data: list[UserResponse]
    has_more: bool
    next_cursor: str | None = None


def _user_resp(u: dict[str, Any]) -> UserResponse:
    return UserResponse(
        id=u["id"],
        email=u["email"],
        display_name=u["display_name"],
        auth_provider=u["auth_provider"],
        is_system_admin=bool(u["is_system_admin"]),
        created_at=u["created_at"],
        updated_at=u["updated_at"],
        deleted_at=u.get("deleted_at"),
    )


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> UserResponse:
    h = get_handler()
    email = body.email.strip()
    display_name = body.display_name.strip()
    if not email:
        raise bad_request("email is required")
    if "@" not in email:
        raise bad_request("invalid email format")
    if not display_name:
        raise bad_request("display_name is required")
    if len(body.password) < 8:
        raise bad_request("password must be at least 8 characters")
    if body.is_system_admin and not has_role(key_info.role, ROLE_SYSTEM_ADMIN):
        raise forbidden("only system admins may create system admin users")
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    try:
        user = await repo.create_user(
            h.db,
            email=email,
            display_name=display_name,
            password_hash=pw_hash,
            auth_provider="local",
            is_system_admin=body.is_system_admin,
        )
    except repo.ConflictError:
        raise conflict("email already in use")
    except Exception:
        raise internal_error("failed to create user")
    if not body.is_system_admin and key_info.org_id:
        try:
            await repo.create_org_membership(h.db, key_info.org_id, user["id"], ROLE_MEMBER)
        except repo.ConflictError:
            pass
        except Exception:
            raise internal_error("failed to add user to organization")
    return _user_resp(user)


@router.get("/users", response_model=PaginatedUsersResponse)
async def list_users(
    limit: int | None = Query(20),
    cursor: str | None = Query(None),
    include_deleted: bool = Query(False),
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> PaginatedUsersResponse:
    h = get_handler()
    p = parse_pagination(limit, cursor)
    users = await repo.list_users(h.db, p.cursor, p.limit + 1, include_deleted)
    has_more = len(users) > p.limit
    if has_more:
        users = users[: p.limit]
    return PaginatedUsersResponse(
        data=[_user_resp(u) for u in users],
        has_more=has_more,
        next_cursor=users[-1]["id"] if has_more and users else None,
    )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> UserResponse:
    h = get_handler()
    user = await repo.get_user(h.db, user_id)
    if not user:
        raise not_found("user not found")
    if not has_role(key_info.role, ROLE_SYSTEM_ADMIN):
        try:
            await repo.get_user_org_role(h.db, user_id, key_info.org_id)
        except repo.NotFoundError:
            raise not_found("user not found")
    return _user_resp(user)


async def _authorize_user_update(h: Any, key_info: KeyInfo, user_id: str, body: UpdateUserRequest) -> bool:
    """Enforce who may change what on PATCH /users/{id}. Returns True when the caller edits itself.

    - System admins may edit anyone (password changes on themselves still need current_password).
    - Everyone else may change their own display name, email and password (email/password need
      current_password) but never is_system_admin.
    - An org admin may change only the display name of another user, and only when that user is not
      a system admin, has a strictly lower role in the caller's org and belongs to no other org.
    """
    is_self = bool(key_info.user_id) and key_info.user_id == user_id
    caller_is_sysadmin = has_role(key_info.role, ROLE_SYSTEM_ADMIN)
    if body.is_system_admin is not None and not caller_is_sysadmin:
        raise forbidden("only system admins may change is_system_admin")
    if caller_is_sysadmin or is_self:
        return is_self
    if not has_role(key_info.role, ROLE_ORG_ADMIN):
        raise forbidden()
    target = await repo.get_user(h.db, user_id)
    if not target:
        raise not_found("user not found")
    memberships = await repo.list_user_org_roles(h.db, user_id)
    if not key_info.org_id or key_info.org_id not in memberships:
        raise not_found("user not found")
    if body.email is not None or body.password is not None or body.new_password is not None:
        raise forbidden("only system admins may change another user's email or password")
    if target["is_system_admin"]:
        raise forbidden("cannot modify a system admin")
    target_rank = ROLE_RANK.get(memberships[key_info.org_id], ROLE_RANK[ROLE_SYSTEM_ADMIN])
    if target_rank >= ROLE_RANK.get(key_info.role, -1):
        raise forbidden("cannot modify a user with an equal or higher role")
    if any(org_id != key_info.org_id for org_id in memberships):
        raise forbidden("user belongs to other organizations; ask a system admin")
    return False


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    key_info: KeyInfo = Depends(auth_middleware),
) -> UserResponse:
    h = get_handler()
    is_self = await _authorize_user_update(h, key_info, user_id, body)
    if body.password is not None and body.new_password is not None:
        raise bad_request("send either password or new_password, not both")
    new_password = body.new_password if body.new_password is not None else body.password
    fields: dict[str, Any] = {}
    if body.email is not None:
        trimmed = body.email.strip()
        if not trimmed or "@" not in trimmed:
            raise bad_request("invalid email format")
        fields["email"] = trimmed
    if body.display_name is not None:
        trimmed = body.display_name.strip()
        if not trimmed:
            raise bad_request("display_name must not be empty")
        fields["display_name"] = trimmed
    if body.is_system_admin is not None:
        fields["is_system_admin"] = 1 if body.is_system_admin else 0
    if new_password is not None:
        if len(new_password) < 8:
            raise bad_request("password must be at least 8 characters")
        fields["password_hash"] = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    # Self-service changes of credentials (email = login id, password) must re-prove the current password.
    if is_self and ("password_hash" in fields or "email" in fields):
        current_hash = await repo.get_user_password_hash_by_id(h.db, user_id)
        if not current_hash:
            raise bad_request("this account has no local password; credentials are managed by SSO")
        if not body.current_password:
            raise bad_request("current_password is required")
        if not bcrypt.checkpw(body.current_password.encode(), current_hash.encode()):
            raise api_error(400, "invalid_current_password", "current password is incorrect")
    try:
        user = await repo.update_user(h.db, user_id, fields)
    except repo.NotFoundError:
        raise not_found("user not found")
    except repo.ConflictError:
        raise conflict("email already in use")
    except Exception:
        raise internal_error("failed to update user")
    if "is_system_admin" in fields:
        await h.refresh_keys(user_id=user_id)
    if not is_self and ("password_hash" in fields or "email" in fields):
        # Admin reset of someone else's credentials: kill that user's existing web sessions.
        await h.revoke_user_sessions(user_id)
    return _user_resp(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> Response:
    h = get_handler()
    try:
        await repo.delete_user(h.db, user_id)
    except repo.NotFoundError:
        raise not_found("user not found")
    except Exception:
        raise internal_error("failed to delete user")
    # repo.delete_user revokes sessions in the DB; drop every cached key the user owned.
    await h.refresh_keys(user_id=user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
