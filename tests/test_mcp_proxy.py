"""Unit tests for the external MCP gateway proxy (no DB: fake db + httpx MockTransport)."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from wai.api.admin import mcp_proxy
from wai.api.admin.common import KeyInfo
from wai.crypto.aes import encrypt_string

ENC_KEY = b"k" * 32
SERVER_ID = "srv-1"
UPSTREAM_URL = "https://mcp.example.com/mcp"
MIGRATION = Path(mcp_proxy.__file__).resolve().parents[2] / "db" / "migrations" / "0015_mcp_usage_events.up.sql"


class FakeDB:
    def __init__(self, server: dict, access: dict[str, set[str]] | None = None, blocked: set[str] | None = None,
                 fail_insert: bool = False):
        self.server = server
        self.access = access or {}
        self.blocked = blocked or set()
        self.fail_insert = fail_insert
        self.inserts: list[tuple] = []

    async def fetchone(self, sql, params=()):
        if "FROM mcp_servers" in sql:
            return dict(self.server) if params[0] == self.server["alias"] else None
        return None

    async def fetchall(self, sql, params=()):
        for table in ("org_mcp_access", "team_mcp_access", "key_mcp_access"):
            if f"FROM {table}" in sql:
                return [{"server_id": s} for s in self.access.get(f"{table}:{params[0]}", set())]
        if "FROM mcp_tool_blocklist" in sql:
            return [{"tool_name": t} for t in self.blocked]
        return []

    async def execute(self, sql, params=()):
        if "INSERT INTO mcp_usage_events" in sql:
            if self.fail_insert:
                raise RuntimeError('relation "mcp_usage_events" does not exist')
            self.inserts.append(params)

    async def commit(self):
        pass


class FakeRequest:
    def __init__(self, body: dict | list, headers: dict[str, str] | None = None):
        self._body = json.dumps(body).encode()
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}

    async def body(self) -> bytes:
        return self._body


def _server(**overrides) -> dict:
    server = {
        "id": SERVER_ID, "alias": "ext", "url": UPSTREAM_URL, "org_id": None, "team_id": None,
        "auth_type": "bearer", "auth_header": "",
        "auth_token_enc": encrypt_string("s3cret", ENC_KEY, f"mcp_server:{SERVER_ID}".encode()),
    }
    server.update(overrides)
    return server


def _key(**overrides) -> KeyInfo:
    base = {"id": "key-1", "key_type": "user", "role": "member", "org_id": "org-1", "team_id": "team-1",
            "user_id": "user-1"}
    base.update(overrides)
    return KeyInfo(**base)


def _setup(monkeypatch, db: FakeDB, handler_fn, explicit_allow: bool | None = None):
    seen: list[httpx.Request] = []

    def _handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return handler_fn(req)

    h = SimpleNamespace(
        db=db, encryption_key=ENC_KEY, mcp_allow_private_urls=True, mcp_call_timeout=5.0,
        _mcp_client=httpx.AsyncClient(transport=httpx.MockTransport(_handler)),
        mcp_access_explicit_allow=explicit_allow,
    )
    monkeypatch.setattr(mcp_proxy, "get_handler", lambda: h)
    monkeypatch.delenv(mcp_proxy.EXPLICIT_ALLOW_ENV, raising=False)
    return h, seen


def _ok(req: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}}, headers={"Mcp-Session-Id": "sess-9"})


def _call(name: str) -> dict:
    return {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": name, "arguments": {}}}


async def test_upstream_receives_decrypted_bearer_auth_and_session_header(monkeypatch):
    db = FakeDB(_server())
    _, seen = _setup(monkeypatch, db, _ok)
    resp = await mcp_proxy.handle_mcp_proxy(
        "ext", FakeRequest(_call("search"), {"Mcp-Session-Id": "sess-1", "Authorization": "Bearer wai-key"}), _key()
    )
    assert resp.status_code == 200
    assert seen[0].headers["authorization"] == "Bearer s3cret"
    assert seen[0].headers["mcp-session-id"] == "sess-1"
    assert "text/event-stream" in seen[0].headers["accept"]
    assert resp.headers["mcp-session-id"] == "sess-9"


async def test_custom_header_auth(monkeypatch):
    db = FakeDB(_server(auth_type="header", auth_header="X-Api-Key"))
    _, seen = _setup(monkeypatch, db, _ok)
    await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("search")), _key())
    assert seen[0].headers["x-api-key"] == "s3cret"
    assert "authorization" not in seen[0].headers


async def test_usage_logs_tool_name_and_iso_timestamp(monkeypatch):
    db = FakeDB(_server())
    _setup(monkeypatch, db, _ok)
    await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("search")), _key())
    assert len(db.inserts) == 1
    row = db.inserts[0]
    assert row[1:7] == ("org-1", "team-1", "user-1", "key-1", "ext", "search")
    assert row[8] == "success"
    assert "T" in row[9] and row[9].endswith("+00:00")


async def test_usage_logging_failure_is_warned_not_raised(monkeypatch, caplog):
    db = FakeDB(_server(), fail_insert=True)
    _setup(monkeypatch, db, _ok)
    with caplog.at_level("WARNING", logger="wai.mcp.proxy"):
        resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("search")), _key())
    assert resp.status_code == 200
    assert any("failed to record MCP usage" in r.message for r in caplog.records)


async def test_blocked_tool_call_rejected_without_upstream(monkeypatch):
    db = FakeDB(_server(), blocked={"rm_rf"})
    _, seen = _setup(monkeypatch, db, _ok)
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("rm_rf")), _key())
    doc = json.loads(resp.body)
    assert resp.status_code == 403
    assert doc["id"] == 7 and "blocked" in doc["error"]["message"]
    assert seen == []


async def test_blocked_tool_in_batch_rejected(monkeypatch):
    db = FakeDB(_server(), blocked={"rm_rf"})
    _, seen = _setup(monkeypatch, db, _ok)
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest([_call("ok"), _call("rm_rf")]), _key())
    assert resp.status_code == 403
    assert seen == []


def _tools_list_json(req: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "a"}, {"name": "rm_rf"}]}})


def _tools_list_sse(req: httpx.Request) -> httpx.Response:
    payload = json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "a"}, {"name": "rm_rf"}]}})
    return httpx.Response(200, content=f"event: message\ndata: {payload}\n\n",
                          headers={"Content-Type": "text/event-stream"})


@pytest.mark.parametrize("upstream", [_tools_list_json, _tools_list_sse])
async def test_tools_list_filters_blocked(monkeypatch, upstream):
    db = FakeDB(_server(), blocked={"rm_rf"})
    _setup(monkeypatch, db, upstream)
    resp = await mcp_proxy.handle_mcp_proxy(
        "ext", FakeRequest({"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                           {"Accept": "application/json, text/event-stream"}), _key()
    )
    body = resp.body.decode()
    assert "rm_rf" not in body and '"a"' in body
    if upstream is _tools_list_sse:
        assert resp.media_type == "text/event-stream"
        assert body.startswith("event: message\ndata: ")
    else:
        assert resp.media_type == "application/json"


async def test_empty_org_allowlist_allows_by_default(monkeypatch):
    db = FakeDB(_server())
    _, seen = _setup(monkeypatch, db, _ok)
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())
    assert resp.status_code == 200 and len(seen) == 1


async def test_empty_org_allowlist_denies_in_explicit_allow_mode(monkeypatch):
    db = FakeDB(_server())
    _, seen = _setup(monkeypatch, db, _ok, explicit_allow=None)
    monkeypatch.setenv(mcp_proxy.EXPLICIT_ALLOW_ENV, "true")
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())
    assert resp.status_code == 403 and seen == []


async def test_explicit_allow_mode_permits_listed_and_system_admin(monkeypatch):
    db = FakeDB(_server(), access={"org_mcp_access:org-1": {SERVER_ID}})
    _setup(monkeypatch, db, _ok, explicit_allow=True)
    assert (await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())).status_code == 200
    db2 = FakeDB(_server())
    _setup(monkeypatch, db2, _ok, explicit_allow=True)
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key(role="system_admin"))
    assert resp.status_code == 200


async def test_org_allowlist_excluding_server_denies(monkeypatch):
    db = FakeDB(_server(), access={"org_mcp_access:org-1": {"other"}})
    _setup(monkeypatch, db, _ok)
    assert (await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())).status_code == 403


@pytest.mark.parametrize("table,entity", [("team_mcp_access", "team-1"), ("key_mcp_access", "key-1")])
async def test_team_and_key_allowlists_enforced(monkeypatch, table, entity):
    db = FakeDB(_server(), access={f"{table}:{entity}": {"other"}})
    _, seen = _setup(monkeypatch, db, _ok)
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())
    assert resp.status_code == 403 and seen == []
    db.access[f"{table}:{entity}"] = {SERVER_ID}
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())
    assert resp.status_code == 200


@pytest.mark.parametrize("table,entity", [("team_mcp_access", "team-1"), ("key_mcp_access", "key-1")])
async def test_allowlists_do_not_block_org_scoped_servers(monkeypatch, table, entity):
    # Team/key allowlists are built from global servers only; an org's own servers stay reachable.
    db = FakeDB(_server(org_id="org-1"), access={f"{table}:{entity}": {"other"}})
    _setup(monkeypatch, db, _ok)
    assert (await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("x")), _key())).status_code == 200


async def test_upstream_timeout_logged_as_timeout(monkeypatch):
    def _boom(req):
        raise httpx.ReadTimeout("slow", request=req)

    db = FakeDB(_server())
    _setup(monkeypatch, db, _boom)
    resp = await mcp_proxy.handle_mcp_proxy("ext", FakeRequest(_call("search")), _key())
    assert resp.status_code == 500
    assert db.inserts[0][6] == "search" and db.inserts[0][8] == "timeout"


def test_migration_columns_match_insert():
    sql = open(MIGRATION, encoding="utf-8").read()
    for col in ("id", "org_id", "team_id", "user_id", "key_id", "server_alias", "tool_name",
                "duration_ms", "status", "timestamp"):
        assert f"\n    {col} " in sql
    assert "CREATE TABLE IF NOT EXISTS mcp_usage_events" in sql
