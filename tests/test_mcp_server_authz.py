"""Scope checks for MCP server admin endpoints."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from wai.api.admin import mcp_servers
from wai.api.admin.common import KeyInfo


SERVERS = {
    "global": {"id": "global", "org_id": None, "team_id": None},
    "org-a": {"id": "org-a", "org_id": "A", "team_id": None},
    "team-a1": {"id": "team-a1", "org_id": "A", "team_id": "T1"},
}


@pytest.fixture(autouse=True)
def fake_repo(monkeypatch):
    async def get_server(h, server_id):
        return dict(SERVERS[server_id])

    async def is_team_member(db, user_id, team_id):
        return (user_id, team_id) == ("u-t1", "T1")

    monkeypatch.setattr(mcp_servers, "_get_server", get_server)
    monkeypatch.setattr(mcp_servers.repo, "is_team_member", is_team_member)


H = SimpleNamespace(db=None)


def key(role: str, org: str = "A", user: str = "u1", team: str = "") -> KeyInfo:
    return KeyInfo(id="k", key_type="user", role=role, org_id=org, user_id=user, team_id=team)


async def check(k: KeyInfo, sid: str, write: bool) -> int:
    try:
        await mcp_servers._get_authorized_server(H, k, sid, write=write)
        return 200
    except HTTPException as exc:
        return exc.status_code


@pytest.mark.parametrize(
    "k,sid,write,expected",
    [
        (key("system_admin", org="Z"), "org-a", True, 200),
        (key("member"), "global", False, 200),
        (key("org_admin"), "global", True, 403),
        (key("member"), "org-a", False, 200),
        (key("member"), "org-a", True, 403),
        (key("org_admin"), "org-a", True, 200),
        (key("org_admin", org="B"), "org-a", False, 404),
        (key("org_admin", org="B"), "org-a", True, 404),
        (key("team_admin", user="u-t1"), "team-a1", True, 200),
        (key("team_admin", user="u-other"), "team-a1", True, 403),
        (key("team_admin", user="", team="T1"), "team-a1", True, 200),
        (key("member", user="u-t1"), "team-a1", True, 403),
    ],
)
async def test_server_scope(k, sid, write, expected):
    assert await check(k, sid, write) == expected


def test_require_org_access_blocks_other_org():
    with pytest.raises(HTTPException) as exc:
        mcp_servers._require_org_access(key("org_admin", org="B"), "A")
    assert exc.value.status_code == 403
    mcp_servers._require_org_access(key("system_admin", org="B"), "A")
