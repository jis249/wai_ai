"""Dashboard model/deployment management reaches the live proxy registry.

Covers: upstream keys stored encrypted (with the AAD the registry decrypts with), PATCH key
semantics and column whitelists, reload of the live registry after every mutation (failures
tolerated), load_db_into_registry loading deployments (key inheritance rule, YAML deployment
preservation, removal on reload) and app.py passing the reliability config to ProxyHandler.
"""

from __future__ import annotations

import ast
import logging
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from wai.api.admin import deployments as deps_api
from wai.api.admin import models as models_api
from wai.api.admin.common import KeyInfo
from wai.api.admin.handler import ModelRegistry
from wai.config.models import DeploymentConfig, ModelConfig
from wai.crypto.aes import decrypt_string, encrypt_string
from wai.proxy.registry import Model, Registry, load_db_into_registry, same_host

ENC_KEY = bytes(range(32))

SCHEMA = """
CREATE TABLE models (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, provider TEXT NOT NULL,
    base_url TEXT NOT NULL, api_key_encrypted TEXT, max_context_tokens INTEGER,
    input_price_per_1m REAL, output_price_per_1m REAL, azure_deployment TEXT,
    azure_api_version TEXT, aliases TEXT NOT NULL DEFAULT '', timeout TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'api', created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT,
    model_type TEXT NOT NULL DEFAULT 'chat', strategy TEXT NOT NULL DEFAULT '',
    max_retries INTEGER NOT NULL DEFAULT 0, gcp_project TEXT NOT NULL DEFAULT '',
    gcp_location TEXT NOT NULL DEFAULT '', fallback_model_id TEXT REFERENCES models(id)
);
CREATE TABLE model_deployments (
    id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES models(id), name TEXT NOT NULL,
    provider TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT,
    azure_deployment TEXT NOT NULL DEFAULT '', azure_api_version TEXT NOT NULL DEFAULT '',
    weight INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT,
    gcp_project TEXT NOT NULL DEFAULT '', gcp_location TEXT NOT NULL DEFAULT '',
    UNIQUE (model_id, name)
);
"""


class FakeDB:
    """Minimal async facade over in-memory sqlite, mirroring the real models schema."""

    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.statements: list[str] = []

    async def execute(self, sql, params=()):
        self.statements.append(sql)
        return self.conn.execute(sql, tuple(params))

    async def fetchall(self, sql, params=()):
        return [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]

    async def fetchone(self, sql, params=()):
        r = self.conn.execute(sql, tuple(params)).fetchone()
        return dict(r) if r else None

    async def commit(self):
        self.conn.commit()

    def row(self, sql, params=()):
        r = self.conn.execute(sql, params).fetchone()
        return dict(r) if r else None


ADMIN = KeyInfo(id="k", key_type="user", role="system_admin", org_id="A", user_id="", team_id="")


@pytest.fixture
def h(monkeypatch):
    db = FakeDB()
    live = Registry()
    calls: list[int] = []

    async def reload_models():
        calls.append(1)
        await load_db_into_registry(db, live, ENC_KEY)
        await models_api.reload_admin_model_registry(handler)

    handler = SimpleNamespace(
        db=db, encryption_key=ENC_KEY, registry=ModelRegistry(), reload_models=reload_models,
        live=live, reload_calls=calls,
    )
    for mod in (models_api, deps_api):
        monkeypatch.setattr(mod, "get_handler", lambda: handler)
    return handler


async def _create(name="m1", **kw):
    body = models_api.CreateModelRequest(name=name, provider="openai", base_url="https://api.a.com/v1", **kw)
    return await models_api.create_model(body, ADMIN)


def _stored_key(h, table, rid):
    return h.db.row(f"SELECT api_key_encrypted FROM {table} WHERE id = ?", (rid,))["api_key_encrypted"]


# --- model keys -------------------------------------------------------------------------


async def test_create_model_stores_key_encrypted_with_registry_aad(h):
    resp = await _create(api_key=" sk-one ")
    assert "api_key" not in resp.model_dump()
    assert resp.has_api_key is True
    enc = _stored_key(h, "models", resp.id)
    assert enc and "sk-one" not in enc
    assert decrypt_string(enc, ENC_KEY, f"model:{resp.id}".encode()) == "sk-one"
    # ...and the live proxy registry picked it up immediately.
    assert h.reload_calls == [1]
    assert h.live.resolve("m1").api_key == "sk-one"
    assert [m["name"] for m in h.registry.list_info()] == ["m1"]


async def test_create_model_without_key_stores_null(h):
    resp = await _create()
    assert _stored_key(h, "models", resp.id) is None
    assert resp.has_api_key is False


async def test_update_model_key_semantics(h):
    mid = (await _create(api_key="sk-one")).id
    upd = models_api.UpdateModelRequest

    await models_api.update_model(mid, upd(max_context_tokens=100), ADMIN)  # absent: unchanged
    assert decrypt_string(_stored_key(h, "models", mid), ENC_KEY, f"model:{mid}".encode()) == "sk-one"
    await models_api.update_model(mid, upd(api_key=""), ADMIN)  # "": unchanged
    await models_api.update_model(mid, upd(api_key=None), ADMIN)  # null: unchanged
    assert decrypt_string(_stored_key(h, "models", mid), ENC_KEY, f"model:{mid}".encode()) == "sk-one"

    resp = await models_api.update_model(mid, upd(api_key="sk-two"), ADMIN)
    assert resp.has_api_key and "api_key" not in resp.model_dump()
    assert decrypt_string(_stored_key(h, "models", mid), ENC_KEY, f"model:{mid}".encode()) == "sk-two"
    assert h.live.resolve("m1").api_key == "sk-two"

    with pytest.raises(HTTPException) as exc:
        await models_api.update_model(mid, upd(api_key="x", clear_api_key=True), ADMIN)
    assert exc.value.status_code == 400

    resp = await models_api.update_model(mid, upd(clear_api_key=True), ADMIN)
    assert _stored_key(h, "models", mid) is None and resp.has_api_key is False
    assert h.live.resolve("m1").api_key == ""
    # The old code wrote a non-existent "api_key" column; the whitelist never does.
    assert not any("api_key =" in s for s in h.db.statements)


async def test_update_model_ignores_nulls_and_validates(h):
    mid = (await _create()).id
    upd = models_api.UpdateModelRequest
    resp = await models_api.update_model(mid, upd(name=None, provider=None, strategy="weighted"), ADMIN)
    assert resp.name == "m1" and resp.provider == "openai" and resp.strategy == "weighted"
    for bad in (upd(name=" "), upd(type="nope")):
        with pytest.raises(HTTPException) as exc:
            await models_api.update_model(mid, bad, ADMIN)
        assert exc.value.status_code == 400
    await _create(name="m2")
    with pytest.raises(HTTPException) as exc:
        await models_api.update_model(mid, upd(name="m2"), ADMIN)
    assert exc.value.status_code == 409


async def test_fallback_name_is_stored_as_id(h):
    target = await _create(name="fb")
    resp = await _create(name="m1", fallback_model_name="fb")
    assert resp.fallback_model_name == "fb"
    assert h.db.row("SELECT fallback_model_id FROM models WHERE id = ?", (resp.id,))["fallback_model_id"] == target.id
    assert h.live.resolve("m1").fallback_model_name == "fb"
    listed = await models_api.list_models(limit=20, cursor=None, _=ADMIN)
    assert {m.name: m.fallback_model_name for m in listed.data} == {"fb": "", "m1": "fb"}

    upd = models_api.UpdateModelRequest
    with pytest.raises(HTTPException) as exc:
        await models_api.update_model(resp.id, upd(fallback_model_name="m1"), ADMIN)
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        await models_api.update_model(resp.id, upd(fallback_model_name="missing"), ADMIN)
    assert exc.value.status_code == 400
    cleared = await models_api.update_model(resp.id, upd(fallback_model_name=""), ADMIN)
    assert cleared.fallback_model_name == ""


# --- deployment keys --------------------------------------------------------------------


async def _create_dep(mid, name="d1", **kw):
    body = deps_api.CreateDeploymentRequest(name=name, provider="openai", base_url="https://api.b.com/v1", **kw)
    return await deps_api.create_deployment(mid, body, ADMIN)


async def test_create_deployment_stores_key_encrypted(h):
    mid = (await _create()).id
    dep = await _create_dep(mid, api_key="dk-1")
    assert dep.has_api_key and "api_key" not in dep.model_dump()
    enc = _stored_key(h, "model_deployments", dep.id)
    assert decrypt_string(enc, ENC_KEY, f"model_deployment:{dep.id}".encode()) == "dk-1"
    live = h.live.resolve("m1")
    assert [(d.name, d.api_key) for d in live.deployments] == [("d1", "dk-1")]
    none = await _create_dep(mid, name="d2")
    assert _stored_key(h, "model_deployments", none.id) is None
    with pytest.raises(HTTPException) as exc:
        await _create_dep(mid, name="d2")
    assert exc.value.status_code == 409


async def test_update_deployment_key_semantics_and_whitelist(h):
    mid = (await _create()).id
    did = (await _create_dep(mid, api_key="dk-1")).id
    upd = deps_api.UpdateDeploymentRequest
    aad = f"model_deployment:{did}".encode()

    await deps_api.update_deployment(mid, did, upd(weight=5), ADMIN)
    await deps_api.update_deployment(mid, did, upd(api_key=""), ADMIN)
    assert decrypt_string(_stored_key(h, "model_deployments", did), ENC_KEY, aad) == "dk-1"

    resp = await deps_api.update_deployment(mid, did, upd(api_key="dk-2", priority=3), ADMIN)
    assert resp.priority == 3 and resp.weight == 5
    assert decrypt_string(_stored_key(h, "model_deployments", did), ENC_KEY, aad) == "dk-2"
    assert h.live.resolve("m1").deployments[0].api_key == "dk-2"

    resp = await deps_api.update_deployment(mid, did, upd(clear_api_key=True), ADMIN)
    assert resp.has_api_key is False and _stored_key(h, "model_deployments", did) is None
    with pytest.raises(HTTPException) as exc:
        await deps_api.update_deployment(mid, did, upd(api_key="a", clear_api_key=True), ADMIN)
    assert exc.value.status_code == 400

    # Unknown keys never reach SQL (explicit whitelist, not the request's keys).
    body = upd.model_construct(**{"weight": 2, "is_active; DROP TABLE models": 1})
    body.__pydantic_fields_set__ = {"weight", "is_active; DROP TABLE models"}
    await deps_api.update_deployment(mid, did, body, ADMIN)
    updates = [s for s in h.db.statements if s.startswith("UPDATE model_deployments SET")]
    assert updates and all("DROP" not in s and "api_key =" not in s for s in updates)
    allowed = set(deps_api._DEPLOYMENT_UPDATE_COLUMNS) | {"updated_at"}
    for stmt in updates:
        sets = stmt.split(" SET ", 1)[1].split(" WHERE ", 1)[0]
        assert {part.split("=")[0].strip() for part in sets.split(",")} <= allowed


async def test_deployment_on_other_model_is_404(h):
    m1 = (await _create()).id
    m2 = (await _create(name="m2")).id
    did = (await _create_dep(m1)).id
    with pytest.raises(HTTPException) as exc:
        await deps_api.update_deployment(m2, did, deps_api.UpdateDeploymentRequest(weight=2), ADMIN)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await deps_api.delete_deployment(m2, did, ADMIN)
    assert exc.value.status_code == 404


# --- reload after every mutation --------------------------------------------------------


async def test_reload_called_after_each_mutation(h):
    mid = (await _create()).id
    await models_api.update_model(mid, models_api.UpdateModelRequest(max_retries=2), ADMIN)
    await models_api.deactivate_model(mid, ADMIN)
    with pytest.raises(KeyError):
        h.live.resolve("m1")
    await models_api.activate_model(mid, ADMIN)
    assert h.live.resolve("m1").max_retries == 2
    did = (await _create_dep(mid)).id
    await deps_api.update_deployment(mid, did, deps_api.UpdateDeploymentRequest(weight=3), ADMIN)
    await deps_api.delete_deployment(mid, did, ADMIN)
    assert h.live.resolve("m1").deployments == []
    await models_api.delete_model(mid, ADMIN)
    assert len(h.reload_calls) == 8
    with pytest.raises(KeyError):
        h.live.resolve("m1")
    # A no-op PATCH does not reload.
    other = (await _create(name="m2")).id
    await models_api.update_model(other, models_api.UpdateModelRequest(), ADMIN)
    assert len(h.reload_calls) == 9


async def test_reload_failure_is_tolerated_and_logged(h, caplog):
    async def boom():
        raise RuntimeError("probe exploded")

    h.reload_models = boom
    with caplog.at_level(logging.ERROR, logger="wai.admin.models"):
        resp = await _create(api_key="sk")
        await models_api.deactivate_model(resp.id, ADMIN)
        await _create_dep(resp.id)
    assert h.db.row("SELECT is_active FROM models WHERE id = ?", (resp.id,))["is_active"] == 0
    assert "live proxy model reload failed" in caplog.text
    # The admin registry is still refreshed from the DB.
    assert h.registry.list_info() == []


async def test_reload_without_hook_refreshes_admin_registry(h):
    h.reload_models = None
    await _create()
    assert [m["name"] for m in h.registry.list_info()] == ["m1"]


# --- load_db_into_registry --------------------------------------------------------------


def _insert_model(db, mid, name, base_url="https://api.a.com/v1", key=None, active=1, deleted=None, source="api"):
    enc = encrypt_string(key, ENC_KEY, f"model:{mid}".encode()) if key else None
    db.conn.execute(
        """INSERT INTO models (id, name, provider, base_url, api_key_encrypted, is_active, deleted_at, source)
           VALUES (?, ?, 'openai', ?, ?, ?, ?, ?)""",
        (mid, name, base_url, enc, active, deleted, source),
    )


def _insert_dep(db, did, mid, name, base_url, key=None, active=1, deleted=None, priority=0, weight=1):
    enc = encrypt_string(key, ENC_KEY, f"model_deployment:{did}".encode()) if key else None
    db.conn.execute(
        """INSERT INTO model_deployments (id, model_id, name, provider, base_url, api_key_encrypted,
                                          is_active, deleted_at, priority, weight)
           VALUES (?, ?, ?, 'openai', ?, ?, ?, ?, ?, ?)""",
        (did, mid, name, base_url, enc, active, deleted, priority, weight),
    )


async def test_registry_loads_deployments_with_key_inheritance_rule():
    db = FakeDB()
    _insert_model(db, "m", "m", base_url="https://api.a.com/v1", key="model-key")
    _insert_dep(db, "d-own", "m", "own", "https://other.example/v1", key="own-key", priority=0)
    _insert_dep(db, "d-same", "m", "same-host", "https://API.A.com:443/v2", priority=1, weight=4)
    _insert_dep(db, "d-other", "m", "other-host", "https://evil.example/v1", priority=2)
    _insert_dep(db, "d-off", "m", "inactive", "https://api.a.com/v1", active=0)
    _insert_dep(db, "d-del", "m", "deleted", "https://api.a.com/v1", deleted="2026-01-01")
    reg = Registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    deps = reg.resolve("m").deployments
    assert [(d.name, d.api_key, d.priority, d.weight) for d in deps] == [
        ("own", "own-key", 0, 1),
        ("same-host", "model-key", 1, 4),
        ("other-host", "", 2, 1),
    ]
    assert reg.list_info()[0].deployment_count == 3


async def test_deployments_of_inactive_models_are_not_loaded():
    db = FakeDB()
    _insert_model(db, "m", "m", active=0)
    _insert_dep(db, "d", "m", "d", "https://api.a.com/v1")
    reg = Registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    assert reg.list_info() == []


async def test_undecryptable_deployment_key_is_not_replaced_by_model_key():
    db = FakeDB()
    _insert_model(db, "m", "m", key="model-key")
    _insert_dep(db, "d", "m", "d", "https://api.a.com/v1")
    # Encrypted with the wrong AAD: decrypt fails, and it must not silently inherit.
    db.conn.execute(
        "UPDATE model_deployments SET api_key_encrypted = ? WHERE id = 'd'",
        (encrypt_string("x", ENC_KEY, b"model:m"),),
    )
    reg = Registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    assert reg.resolve("m").deployments[0].api_key == ""


def test_same_host():
    assert same_host("https://a.com/v1", "https://A.com:443/x")
    assert not same_host("https://a.com/v1", "http://a.com/v1")
    assert not same_host("https://a.com", "https://a.com.evil.io")
    assert not same_host("", "")


def _yaml_registry() -> Registry:
    return Registry.from_yaml([
        ModelConfig(
            name="y", provider="openai", base_url="https://y.com/v1", api_key="yk",
            deployments=[DeploymentConfig(name="yd1", provider="openai", base_url="https://y1.com", api_key="k1")],
        ),
        ModelConfig(name="yaml-only", provider="openai", base_url="https://z.com/v1"),
    ])


async def test_yaml_deployments_preserved_when_db_has_none():
    db = FakeDB()
    _insert_model(db, "y-id", "y", base_url="https://y.com/v1", key="yk", source="yaml")
    reg = _yaml_registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    assert [(d.name, d.api_key) for d in reg.resolve("y").deployments] == [("yd1", "k1")]
    assert reg.resolve("yaml-only").base_url == "https://z.com/v1"
    # DB deployments, once added, replace the YAML ones.
    _insert_dep(db, "d", "y-id", "dbdep", "https://y.com/v2")
    await load_db_into_registry(db, reg, ENC_KEY)
    assert [(d.name, d.api_key) for d in reg.resolve("y").deployments] == [("dbdep", "yk")]


async def test_removed_db_models_disappear_on_reload():
    db = FakeDB()
    _insert_model(db, "y-id", "y", base_url="https://y.com/v1", source="yaml")
    _insert_model(db, "a", "api-model")
    reg = _yaml_registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    assert {m.name for m in reg.list_info()} == {"y", "yaml-only", "api-model"}

    db.conn.execute("UPDATE models SET is_active = 0 WHERE id = 'a'")
    db.conn.execute("UPDATE models SET deleted_at = '2026-01-01' WHERE id = 'y-id'")
    await load_db_into_registry(db, reg, ENC_KEY)
    # yaml-only has no DB row, so it stays; y and api-model are governed by the DB.
    assert {m.name for m in reg.list_info()} == {"yaml-only"}
    with pytest.raises(KeyError):
        reg.resolve("api-model")


async def test_alias_moves_between_models_on_reload():
    db = FakeDB()
    _insert_model(db, "a", "a")
    db.conn.execute("UPDATE models SET aliases = 'fast' WHERE id = 'a'")
    reg = Registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    assert reg.resolve("fast").name == "a"
    db.conn.execute("UPDATE models SET aliases = '' WHERE id = 'a'")
    _insert_model(db, "b", "b")
    db.conn.execute("UPDATE models SET aliases = 'fast' WHERE id = 'b'")
    await load_db_into_registry(db, reg, ENC_KEY)
    assert reg.resolve("fast").name == "b"


async def test_alias_collision_keeps_previous_definition():
    reg = Registry()
    reg.add_model(Model(name="a", base_url="http://old", aliases=["x"]))
    reg.replace_db_models(
        [Model(name="b", aliases=["x"]), Model(name="a", base_url="http://new", aliases=["x"])],
        ["a", "b"],
    )
    # b claimed alias x first; the colliding new "a" is skipped and the old "a" cannot be
    # re-added either (same alias), so only b remains, and nothing raised.
    assert {m.name for m in reg.list_info()} == {"b"}


# --- app.py wiring ----------------------------------------------------------------------


def test_app_passes_reliability_to_every_proxy_handler():
    src = (Path(__file__).resolve().parents[1] / "src" / "wai" / "app.py").read_text(encoding="utf-8")
    calls = [
        node for node in ast.walk(ast.parse(src))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "ProxyHandler"
    ]
    assert len(calls) == 2
    for call in calls:
        kw = {k.arg: ast.unparse(k.value) for k in call.keywords}
        assert kw.get("reliability") == "cfg.reliability"


async def test_deleted_dashboard_row_does_not_shadow_yaml_model():
    # A dashboard model deleted long ago must not hide a YAML model later added with its name.
    db = FakeDB()
    _insert_model(db, "old", "yaml-only", source="api", deleted="2026-01-01")
    reg = _yaml_registry()
    await load_db_into_registry(db, reg, ENC_KEY)
    assert reg.resolve("yaml-only").base_url == "https://z.com/v1"
