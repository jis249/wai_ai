"""Cross-tenant scoping for MCP access allowlists, team model aliases and model health."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from wai.api.admin import mcp_access, model_aliases, models
from wai.api.admin.common import KeyInfo
from wai.proxy.access import ModelAccessCache


class FakeDB:
    """Minimal async facade over an in-memory sqlite3 database."""

    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, alias TEXT, name TEXT, org_id TEXT,
                                      team_id TEXT, is_active INTEGER DEFAULT 1, deleted_at TEXT);
            CREATE TABLE team_mcp_access (id TEXT, team_id TEXT, server_id TEXT);
            CREATE TABLE key_mcp_access (id TEXT, key_id TEXT, server_id TEXT);
            CREATE TABLE org_mcp_access (id TEXT, org_id TEXT, server_id TEXT);
            CREATE TABLE model_aliases (id TEXT PRIMARY KEY, alias TEXT, model_name TEXT,
                                        scope_type TEXT, org_id TEXT, team_id TEXT,
                                        created_by TEXT, created_at TEXT);
            INSERT INTO mcp_servers (id, alias, name, org_id, team_id) VALUES
                ('g', 'g', 'g', NULL, NULL),
                ('sa', 'sa', 'sa', 'A', NULL),
                ('sa1', 'sa1', 'sa1', 'A', 'T1'),
                ('sa2', 'sa2', 'sa2', 'A', 'T2'),
                ('sb', 'sb', 'sb', 'B', NULL);
            INSERT INTO mcp_servers (id, alias, name, org_id, team_id, deleted_at) VALUES
                ('gone', 'gone', 'gone', NULL, NULL, '2026-01-01');
            """
        )

    async def execute(self, sql, params=()):
        return self.conn.execute(sql, tuple(params))

    async def fetchall(self, sql, params=()):
        return [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]

    async def fetchone(self, sql, params=()):
        r = self.conn.execute(sql, tuple(params)).fetchone()
        return dict(r) if r else None

    async def commit(self):
        self.conn.commit()

    def rows(self, sql, params=()):
        return [dict(r) for r in self.conn.execute(sql, params).fetchall()]


TEAMS = {"T1": {"id": "T1", "org_id": "A"}, "T2": {"id": "T2", "org_id": "A"}, "TB": {"id": "TB", "org_id": "B"}}
MEMBERS = {("u-t1", "T1"), ("u-member-t1", "T1")}
KEYS = {
    "kA": {"id": "kA", "org_id": "A", "team_id": None},
    "kA1": {"id": "kA1", "org_id": "A", "team_id": "T1"},
    "kB": {"id": "kB", "org_id": "B", "team_id": None},
}


@pytest.fixture
def h(monkeypatch):
    handler = SimpleNamespace(db=FakeDB(), access_cache=ModelAccessCache(), health_checker=None)

    async def get_team(db, team_id):
        t = TEAMS.get(team_id)
        return dict(t) if t else None

    async def is_team_member(db, user_id, team_id):
        return (user_id, team_id) in MEMBERS

    async def get_api_key(db, key_id):
        k = KEYS.get(key_id)
        return dict(k) if k else None

    for mod in (mcp_access, model_aliases, models):
        monkeypatch.setattr(mod, "get_handler", lambda: handler)
    monkeypatch.setattr(mcp_access.repo, "get_team", get_team)
    monkeypatch.setattr(mcp_access.repo, "is_team_member", is_team_member)
    monkeypatch.setattr(mcp_access.repo, "get_api_key", get_api_key)
    return handler


def key(role: str, org: str = "A", user: str = "u1", team: str = "", ktype: str = "user") -> KeyInfo:
    return KeyInfo(id="k", key_type=ktype, role=role, org_id=org, user_id=user, team_id=team)


async def status_of(coro) -> int:
    try:
        await coro
        return 200
    except HTTPException as exc:
        return exc.status_code


Req = mcp_access.MCPAccessRequest


# --- PUT/GET /orgs/{org}/teams/{team}/mcp-access ---------------------------------------


@pytest.mark.parametrize(
    "k,org,team,expected",
    [
        (key("org_admin"), "A", "T1", 200),
        (key("system_admin", org="Z"), "A", "T1", 200),
        (key("org_admin", org="B"), "A", "T1", 403),  # other org in path
        (key("org_admin"), "A", "TB", 404),  # team belongs to another org
        (key("org_admin"), "A", "nope", 404),
        (key("team_admin", user="u-t1"), "A", "T1", 200),  # human team admin, member of T1
        (key("team_admin", user="u-t1"), "A", "T2", 404),  # not a member of T2
        (key("team_admin", user="", team="T1", ktype="team"), "A", "T1", 403),  # team key
        (key("team_admin", user="", team="T1", ktype="sa"), "A", "T1", 403),  # team SA key
        (key("team_admin", user="", team="T1", ktype="team"), "A", "T2", 404),  # other team
        (key("member", user="u-member-t1"), "A", "T1", 403),
    ],
)
async def test_set_team_mcp_access_authz(h, k, org, team, expected):
    code = await status_of(mcp_access.set_team_mcp_access(org, team, Req(server_ids=[]), k))
    assert code == expected


async def test_set_team_mcp_access_validates_servers(h):
    admin = key("org_admin")
    res = await mcp_access.set_team_mcp_access("A", "T1", Req(server_ids=["g", "sa", "sa1", "sa1"]), admin)
    assert res.server_ids == ["g", "sa", "sa1"]
    stored = h.db.rows("SELECT server_id FROM team_mcp_access WHERE team_id='T1' ORDER BY server_id")
    assert [r["server_id"] for r in stored] == ["g", "sa", "sa1"]
    for bad in ("sb", "sa2", "gone", "unknown"):
        with pytest.raises(HTTPException) as exc:
            await mcp_access.set_team_mcp_access("A", "T1", Req(server_ids=["g", bad]), admin)
        assert exc.value.status_code == 400
    # A rejected write must not have altered the stored allowlist.
    stored = h.db.rows("SELECT server_id FROM team_mcp_access WHERE team_id='T1' ORDER BY server_id")
    assert [r["server_id"] for r in stored] == ["g", "sa", "sa1"]


@pytest.mark.parametrize(
    "k,team,expected",
    [
        (key("org_admin"), "T1", 200),
        (key("org_admin"), "TB", 404),
        (key("team_admin", user="", team="T1", ktype="team"), "T1", 200),  # own team read ok
        (key("team_admin", user="", team="T1", ktype="team"), "T2", 404),
        (key("team_admin", user="u-t1"), "T1", 200),
        (key("team_admin", user="u-t1"), "T2", 404),
    ],
)
async def test_get_team_mcp_access_authz(h, k, team, expected):
    assert await status_of(mcp_access.get_team_mcp_access("A", team, k)) == expected


# --- PUT /orgs/{org}/keys/{key}/mcp-access ---------------------------------------------


async def test_set_key_mcp_access_rejects_other_org_key(h):
    code = await status_of(mcp_access.set_key_mcp_access("A", "kB", Req(server_ids=["g"]), key("org_admin")))
    assert code == 404
    code = await status_of(mcp_access.set_key_mcp_access("A", "missing", Req(server_ids=[]), key("org_admin")))
    assert code == 404
    assert h.db.rows("SELECT * FROM key_mcp_access") == []


async def test_set_key_mcp_access_validates_servers(h):
    admin = key("org_admin")
    res = await mcp_access.set_key_mcp_access("A", "kA", Req(server_ids=["g", "sa"]), admin)
    assert res.server_ids == ["g", "sa"]
    # Team servers only for keys bound to that team.
    assert await status_of(mcp_access.set_key_mcp_access("A", "kA", Req(server_ids=["sa1"]), admin)) == 400
    assert await status_of(mcp_access.set_key_mcp_access("A", "kA1", Req(server_ids=["sa1"]), admin)) == 200
    assert await status_of(mcp_access.set_key_mcp_access("A", "kA1", Req(server_ids=["sa2"]), admin)) == 400
    assert await status_of(mcp_access.set_key_mcp_access("A", "kA", Req(server_ids=["sb"]), admin)) == 400


# --- team model aliases ----------------------------------------------------------------

AliasReq = model_aliases.CreateAliasRequest


async def test_team_alias_rejects_foreign_team(h):
    admin_a = key("org_admin")
    body = AliasReq(alias="gpt", model_name="evil")
    assert await status_of(model_aliases.create_team_alias("A", "TB", body, admin_a)) == 404
    assert await status_of(model_aliases.list_team_aliases("A", "TB", admin_a)) == 404
    assert await status_of(model_aliases.delete_team_alias("A", "TB", "x", admin_a)) == 404
    assert await status_of(model_aliases.create_team_alias("B", "TB", body, admin_a)) == 403
    assert h.db.rows("SELECT * FROM model_aliases") == []


async def test_team_alias_crud_scoped_to_org(h):
    admin_a = key("org_admin")
    created = await model_aliases.create_team_alias("A", "T1", AliasReq(alias="x", model_name="m"), admin_a)
    assert created.org_id == "A" and created.team_id == "T1"
    # A stray row for T1 under a different org id must not be listed or deletable via org A.
    h.db.conn.execute(
        "INSERT INTO model_aliases VALUES ('stray', 'y', 'm', 'team', 'B', 'T1', NULL, '2026-01-01')"
    )
    listed = await model_aliases.list_team_aliases("A", "T1", admin_a)
    assert [a.id for a in listed] == [created.id]
    assert await status_of(model_aliases.delete_team_alias("A", "T1", "stray", admin_a)) == 404
    assert await status_of(model_aliases.delete_team_alias("A", "T1", created.id, admin_a)) == 200


# --- model health ----------------------------------------------------------------------


class FakeHealth:
    def get_all_health(self):
        return [
            {"name": "m-a", "status": "unhealthy", "last_error": "upstream https://secret/ 500"},
            {"name": "m-b", "status": "healthy"},
            {"name": "m-hidden", "status": "unhealthy", "last_error": "boom"},
        ]


async def test_model_health_filtered_for_non_system_admins(h):
    h.health_checker = FakeHealth()
    h.access_cache.load({"A": ["m-a", "m-b"]}, {}, {})
    res = await models.get_model_health(key("member"))
    assert [m["name"] for m in res.models] == ["m-a", "m-b"]
    assert all(not m.get("last_error") for m in res.models)
    res = await models.get_model_health(key("org_admin", org="B"))
    assert res.models == []
    res = await models.get_model_health(key("system_admin", org="Z"))
    assert len(res.models) == 3 and res.models[0]["last_error"]
