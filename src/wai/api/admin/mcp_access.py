"""MCP access control handlers."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from wai.api.admin.common import (
    KeyInfo,
    ROLE_ORG_ADMIN,
    ROLE_SYSTEM_ADMIN,
    ROLE_TEAM_ADMIN,
    bad_request,
    forbidden,
    has_role,
    not_found,
)
from wai.api.admin.handler import get_handler, require_role
from wai.mcp.legacy import is_legacy_mcp_alias
from wai.api.admin import repository as repo

router = APIRouter()


class MCPAccessRequest(BaseModel):
    server_ids: list[str] = Field(default_factory=list)


class MCPAccessResponse(BaseModel):
    server_ids: list[str] = Field(default_factory=list)


def _require_org_access(key_info: KeyInfo, org_id: str) -> None:
    if not has_role(key_info.role, ROLE_SYSTEM_ADMIN) and key_info.org_id != org_id:
        raise forbidden()


async def _load_team_in_org(h, key_info: KeyInfo, org_id: str, team_id: str) -> dict:
    _require_org_access(key_info, org_id)
    team = await repo.get_team(h.db, team_id)
    if not team or team["org_id"] != org_id:
        raise not_found("team not found")
    return team


async def _require_team_read(h, key_info: KeyInfo, org_id: str, team_id: str) -> dict:
    """Org admins; a team key / team SA key bound to this team; or a human member of the team."""
    team = await _load_team_in_org(h, key_info, org_id, team_id)
    if has_role(key_info.role, ROLE_ORG_ADMIN):
        return team
    if key_info.team_id and key_info.team_id == team_id:
        return team
    if key_info.user_id and await repo.is_team_member(h.db, key_info.user_id, team_id):
        return team
    raise not_found("team not found")


async def _require_team_write(h, key_info: KeyInfo, org_id: str, team_id: str) -> dict:
    """Org admins, or a human user (not a team/SA machine key) with team_admin rank who
    is a member of this team."""
    team = await _require_team_read(h, key_info, org_id, team_id)
    if has_role(key_info.role, ROLE_ORG_ADMIN):
        return team
    if (
        key_info.user_id
        and has_role(key_info.role, ROLE_TEAM_ADMIN)
        and await repo.is_team_member(h.db, key_info.user_id, team_id)
    ):
        return team
    raise forbidden()


async def _validate_server_ids(db, org_id: str, team_id: str | None, server_ids: list[str]) -> list[str]:
    """Reject server ids that are not visible to the org: global servers, the org's own
    org-scoped servers, or (when team_id is given) that team's servers."""
    ids = list(dict.fromkeys(s for s in server_ids if s))
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    params: list = [*ids, org_id]
    team_clause = ""
    if team_id:
        team_clause = " OR (org_id = ? AND team_id = ?)"
        params += [org_id, team_id]
    rows = await db.fetchall(
        f"""SELECT id FROM mcp_servers
            WHERE id IN ({placeholders}) AND deleted_at IS NULL
              AND ((org_id IS NULL AND team_id IS NULL)
                   OR (org_id = ? AND team_id IS NULL){team_clause})""",
        tuple(params),
    )
    found = {r["id"] for r in rows}
    unknown = [s for s in ids if s not in found]
    if unknown:
        raise bad_request(f"unknown mcp server ids: {', '.join(unknown)}")
    return ids


async def _get_mcp_access(db, table: str, col: str, entity_id: str) -> list[str]:
    rows = await db.fetchall(
        f"SELECT server_id FROM {table} WHERE {col} = ? ORDER BY server_id", (entity_id,)
    )
    return [r["server_id"] for r in rows]


async def _set_mcp_access(db, table: str, col: str, entity_id: str, server_ids: list[str]) -> None:
    from wai.api.admin.common import new_uuid

    await db.execute(f"DELETE FROM {table} WHERE {col} = ?", (entity_id,))
    for sid in server_ids:
        await db.execute(
            f"INSERT INTO {table} (id, {col}, server_id) VALUES (?, ?, ?)",
            (new_uuid(), entity_id, sid),
        )
    await db.commit()


@router.get("/orgs/{org_id}/mcp-access", response_model=MCPAccessResponse)
async def get_org_mcp_access(
    org_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> MCPAccessResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    ids = await _get_mcp_access(h.db, "org_mcp_access", "org_id", org_id)
    return MCPAccessResponse(server_ids=ids)


@router.put("/orgs/{org_id}/mcp-access", response_model=MCPAccessResponse)
async def set_org_mcp_access(
    org_id: str,
    body: MCPAccessRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> MCPAccessResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    await _set_mcp_access(h.db, "org_mcp_access", "org_id", org_id, body.server_ids)
    return MCPAccessResponse(server_ids=body.server_ids)


@router.get("/orgs/{org_id}/teams/{team_id}/mcp-access", response_model=MCPAccessResponse)
async def get_team_mcp_access(
    org_id: str,
    team_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_TEAM_ADMIN)),
) -> MCPAccessResponse:
    h = get_handler()
    await _require_team_read(h, key_info, org_id, team_id)
    ids = await _get_mcp_access(h.db, "team_mcp_access", "team_id", team_id)
    return MCPAccessResponse(server_ids=ids)


@router.put("/orgs/{org_id}/teams/{team_id}/mcp-access", response_model=MCPAccessResponse)
async def set_team_mcp_access(
    org_id: str,
    team_id: str,
    body: MCPAccessRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_TEAM_ADMIN)),
) -> MCPAccessResponse:
    h = get_handler()
    await _require_team_write(h, key_info, org_id, team_id)
    ids = await _validate_server_ids(h.db, org_id, team_id, body.server_ids)
    await _set_mcp_access(h.db, "team_mcp_access", "team_id", team_id, ids)
    return MCPAccessResponse(server_ids=ids)


@router.get("/orgs/{org_id}/keys/{key_id}/mcp-access", response_model=MCPAccessResponse)
async def get_key_mcp_access(
    org_id: str,
    key_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> MCPAccessResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    key = await repo.get_api_key(h.db, key_id)
    if not key or key["org_id"] != org_id:
        raise not_found("api key not found")
    ids = await _get_mcp_access(h.db, "key_mcp_access", "key_id", key_id)
    return MCPAccessResponse(server_ids=ids)


@router.put("/orgs/{org_id}/keys/{key_id}/mcp-access", response_model=MCPAccessResponse)
async def set_key_mcp_access(
    org_id: str,
    key_id: str,
    body: MCPAccessRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> MCPAccessResponse:
    h = get_handler()
    _require_org_access(key_info, org_id)
    key = await repo.get_api_key(h.db, key_id)
    if not key or key["org_id"] != org_id:
        raise not_found("api key not found")
    ids = await _validate_server_ids(h.db, org_id, key.get("team_id") or None, body.server_ids)
    await _set_mcp_access(h.db, "key_mcp_access", "key_id", key_id, ids)
    return MCPAccessResponse(server_ids=ids)


@router.get("/orgs/{org_id}/available-mcp-servers")
async def list_available_global_mcp_servers(
    org_id: str,
    key_info: KeyInfo = Depends(require_role(ROLE_ORG_ADMIN)),
) -> dict:
    h = get_handler()
    _require_org_access(key_info, org_id)
    allowed = await _get_mcp_access(h.db, "org_mcp_access", "org_id", org_id)
    if allowed:
        placeholders = ",".join("?" * len(allowed))
        rows = await h.db.fetchall(
            f"SELECT id, alias, name FROM mcp_servers WHERE id IN ({placeholders}) AND is_active = 1",
            tuple(allowed),
        )
    else:
        rows = await h.db.fetchall(
            "SELECT id, alias, name FROM mcp_servers WHERE org_id IS NULL AND team_id IS NULL AND is_active = 1"
        )
    return {"servers": [dict(r) for r in rows if not is_legacy_mcp_alias(r["alias"])]}
