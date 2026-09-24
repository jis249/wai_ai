"""Model catalog pricing sync: parser, matcher, preview/apply rules, fetcher, admin API.

SQL runs against in-memory sqlite; no network (httpx.MockTransport, no DNS: the URL
validator is replaced in fetcher tests).
"""

from __future__ import annotations

import json
import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from wai import pricing as pricing_pkg
from wai.api.admin import pricing as pricing_api
from wai.api.admin.common import KeyInfo
from wai.api.admin.handler import auth_middleware
from wai.db.dialect import adapt_sql, split_sql_script
from wai.pricing import service
from wai.pricing.catalog import CatalogError, CatalogFetcher, parse_catalog, parse_catalog_bytes
from wai.pricing.matcher import ModelFacts, candidate_keys, match_model

RAW = {
    "sample_spec": {"input_cost_per_token": 0, "output_cost_per_token": 0},
    "gpt-4o": {
        "input_cost_per_token": 2.5e-06, "output_cost_per_token": 1e-05,
        "max_input_tokens": 128000, "max_output_tokens": 16384, "max_tokens": 16384,
        "litellm_provider": "openai", "mode": "chat", "supports_vision": True,
    },
    "azure/gpt-4o-mini": {
        "input_cost_per_token": 1.65e-07, "output_cost_per_token": 6.6e-07,
        "max_input_tokens": 128000, "litellm_provider": "azure", "mode": "chat",
    },
    "gpt-4o-mini": {"input_cost_per_token": 1.5e-07, "output_cost_per_token": 6e-07},
    "claude-3-5-sonnet-20241022": {"input_cost_per_token": "3e-06", "output_cost_per_token": 1.5e-05},
    "ollama/llama3": {"input_cost_per_token": 0.0, "output_cost_per_token": 0.0, "max_tokens": 8192},
    "text-embedding-3-small": {"input_cost_per_token": 2e-08, "mode": "embedding"},
    "broken-list": ["not", "a", "dict"],
    "broken-cost": {"input_cost_per_token": "abc", "output_cost_per_token": -1, "max_tokens": "x"},
    "": {"input_cost_per_token": 1e-06},
}


def catalog():
    return parse_catalog(RAW, source="test")


# ------------------------------------------------------------------------------ parser


def test_parser_converts_per_token_to_per_1m():
    cat = catalog()
    e = cat.get("gpt-4o")
    assert e.input_per_1m == 2.5 and e.output_per_1m == 10.0
    assert e.context_window == 128000 and e.max_output_tokens == 16384
    assert e.provider == "openai" and e.mode == "chat"
    assert cat.get("azure/gpt-4o-mini").input_per_1m == 0.165
    # numeric strings are accepted
    assert cat.get("claude-3-5-sonnet-20241022").input_per_1m == 3.0
    # case-insensitive lookup
    assert cat.get("GPT-4O").key == "gpt-4o"


def test_parser_tolerates_malformed_entries():
    cat = catalog()
    assert "sample_spec" not in cat.entries
    assert "broken-list" not in cat.entries
    bad = cat.get("broken-cost")
    assert bad is not None and bad.input_per_1m is None and bad.output_per_1m is None
    assert bad.max_tokens == 0 and not bad.has_price
    assert cat.skipped == 2  # list entry and empty key
    assert not cat.get("ollama/llama3").has_price


def test_parser_rejects_non_object_and_bad_json():
    with pytest.raises(CatalogError):
        parse_catalog([1, 2])
    with pytest.raises(CatalogError):
        parse_catalog_bytes(b"{not json")
    with pytest.raises(CatalogError):
        parse_catalog({"x": 1})  # no usable entries


# ------------------------------------------------------------------------------ matcher


def test_match_exact_name():
    m = match_model(ModelFacts(name="gpt-4o", provider="openai"), catalog())
    assert m.key == "gpt-4o" and m.via == "name"


def test_match_prefers_provider_prefixed_key():
    m = match_model(ModelFacts(name="gpt-4o-mini", provider="azure"), catalog())
    assert m.key == "azure/gpt-4o-mini" and m.via == "provider_prefix"


def test_match_via_azure_deployment_field():
    m = match_model(ModelFacts(name="my-chat", provider="azure", azure_deployment="gpt-4o-mini"), catalog())
    assert m.key == "azure/gpt-4o-mini" and m.via == "azure_deployment"


def test_match_via_deployment_rows():
    facts = ModelFacts(
        name="lb-group", provider="",
        deployments=[{"name": "east", "provider": "openai", "azure_deployment": ""},
                     {"name": "west", "provider": "azure", "azure_deployment": "gpt-4o-mini"}],
    )
    m = match_model(facts, catalog())
    assert m.key == "azure/gpt-4o-mini" and m.via == "deployment"


def test_match_manual_pricing_key_is_authoritative():
    cat = catalog()
    m = match_model(ModelFacts(name="gpt-4o", provider="openai", pricing_key="gpt-4o-mini"), cat)
    assert m.key == "gpt-4o-mini" and m.via == "pricing_key"
    assert match_model(ModelFacts(name="gpt-4o", pricing_key="nope/none"), cat) is None


def test_match_ollama_tag_and_unpriced():
    m = match_model(ModelFacts(name="llama3:8b", provider="ollama"), catalog())
    assert m is not None and m.key == "ollama/llama3" and not m.entry.has_price
    assert match_model(ModelFacts(name="qwen3-coder:30b-gpu", provider="ollama"), catalog()) is None


def test_candidate_keys_order_and_dedupe():
    keys = [k for k, _ in candidate_keys(ModelFacts(name="gpt-4o", provider="azure", azure_deployment="gpt-4o"))]
    assert keys[0] == "azure/gpt-4o"
    assert keys.index("azure/gpt-4o") < keys.index("gpt-4o")
    assert len(keys) == len({k.lower() for k in keys})


# ------------------------------------------------------------------------------ fake DB

SCHEMA = """
CREATE TABLE models (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL DEFAULT '',
    max_context_tokens INTEGER, input_price_per_1m REAL, output_price_per_1m REAL,
    azure_deployment TEXT, model_type TEXT NOT NULL DEFAULT 'chat', source TEXT NOT NULL DEFAULT 'api',
    is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT, deleted_at TEXT,
    pricing_source TEXT NOT NULL DEFAULT 'manual', pricing_key TEXT NOT NULL DEFAULT '',
    pricing_synced_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE model_deployments (
    id TEXT PRIMARY KEY, model_id TEXT, name TEXT, provider TEXT, azure_deployment TEXT NOT NULL DEFAULT '',
    deleted_at TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
INSERT INTO settings (key, value) VALUES ('pricing_sync_status', '{}');
"""


class FakeDB:
    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    async def fetchall(self, sql, params=()):
        return [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]

    async def fetchone(self, sql, params=()):
        r = self.conn.execute(sql, tuple(params)).fetchone()
        return dict(r) if r else None

    async def execute(self, sql, params=()):
        cur = self.conn.execute(sql, tuple(params))
        return SimpleNamespace(rowcount=cur.rowcount)

    async def commit(self):
        self.conn.commit()

    def add(self, mid, name, provider, inp=None, out=None, **kw):
        cols = {"id": mid, "name": name, "provider": provider, "input_price_per_1m": inp,
                "output_price_per_1m": out, **kw}
        self.conn.execute(
            f"INSERT INTO models ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
            tuple(cols.values()),
        )

    def model(self, mid):
        return dict(self.conn.execute("SELECT * FROM models WHERE id = ?", (mid,)).fetchone())


class FakeAudit:
    def __init__(self):
        self.events = []

    def log(self, ev):
        self.events.append(ev)


@pytest.fixture
def db():
    d = FakeDB()
    d.add("m-synced", "gpt-4o", "openai", 1.0, 2.0, pricing_source="synced")
    d.add("m-manual", "gpt-4o-mini", "azure", 9.0, 9.0)
    d.add("m-empty", "claude-3-5-sonnet-20241022", "anthropic", None, None)
    d.add("m-same", "text-embedding-3-small", "openai", 0.02, 0.0, max_context_tokens=8191)
    d.add("m-local", "llama3:8b", "ollama", 0, 0)
    d.add("m-none", "qwen3-coder:30b-gpu", "ollama", 0, 0)
    d.add("m-gone", "gpt-4o", "openai", 1, 1, deleted_at="2026-01-01T00:00:00+00:00")
    return d


async def test_preview_actions(db):
    rows = {r.model_id: r for r in await service.build_preview(db, catalog())}
    assert "m-gone" not in rows
    assert rows["m-synced"].action == "update"
    assert rows["m-synced"].input_diff == 1.5 and rows["m-synced"].output_diff == 8.0
    assert rows["m-manual"].action == "manual_locked"
    assert rows["m-manual"].match_key == "azure/gpt-4o-mini"
    assert rows["m-empty"].action == "update"  # nothing configured, nothing to overwrite
    assert rows["m-same"].action == "unchanged"
    assert rows["m-local"].action == "no_match" and "no price" in rows["m-local"].note
    assert rows["m-none"].action == "no_match"
    counts = service.count_actions(list(rows.values()))
    assert counts == {"update": 2, "unchanged": 1, "no_match": 2, "manual_locked": 1}


async def test_apply_explicit_selection_overrides_manual_and_skips_no_match(db):
    res = await service.apply_rows(db, catalog(), ["m-manual", "m-local", "missing"])
    assert [u["model_id"] for u in res.updated] == ["m-manual"]
    reasons = {s["model_id"]: s["reason"] for s in res.skipped}
    assert "no price" in reasons["m-local"] and reasons["missing"] == "model not found"
    m = db.model("m-manual")
    assert m["input_price_per_1m"] == 0.165 and m["output_price_per_1m"] == 0.66
    assert m["pricing_source"] == "manual"  # stays manual unless lock_to_synced
    assert m["pricing_synced_at"] and m["max_context_tokens"] == 128000
    assert db.model("m-local")["input_price_per_1m"] == 0


async def test_apply_lock_to_synced_and_unchanged(db):
    res = await service.apply_rows(db, catalog(), ["m-empty", "m-same"], lock_to_synced=True)
    assert {u["model_id"] for u in res.updated} == {"m-empty", "m-same"}
    assert db.model("m-empty")["pricing_source"] == "synced"
    assert db.model("m-empty")["input_price_per_1m"] == 3.0
    same = db.model("m-same")
    assert same["pricing_source"] == "synced" and same["max_context_tokens"] == 8191


async def test_auto_sync_only_touches_synced_models(db, monkeypatch):
    reloads = []

    async def fake_reload(h, app=None):
        reloads.append(h)

    monkeypatch.setattr(service, "reload_registries", fake_reload)
    audit = FakeAudit()
    h = SimpleNamespace(db=db, audit_logger=audit)
    fetcher = CatalogFetcher(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=RAW)),
                             url_validator=lambda u: u)
    res = await service.run_auto_sync_once(h, fetcher)
    assert [u["model_id"] for u in res["updated"]] == ["m-synced"]
    assert db.model("m-synced")["input_price_per_1m"] == 2.5
    assert db.model("m-manual")["input_price_per_1m"] == 9.0  # manual never overwritten
    assert db.model("m-empty")["input_price_per_1m"] is None
    assert len(reloads) == 1 and audit.events[0].action == "pricing.auto_sync"
    status = await service.read_status(db)
    assert status["last_auto_sync_at"] and status["entries"] == len(catalog())


async def test_auto_sync_failure_keeps_prices_and_records_error(db, monkeypatch):
    alerts = []
    import wai.alerts as alerts_mod

    monkeypatch.setattr(alerts_mod, "emit_alert", lambda *a, **k: alerts.append((a, k)))
    h = SimpleNamespace(db=db, audit_logger=None)
    fetcher = CatalogFetcher(transport=httpx.MockTransport(lambda r: httpx.Response(500)),
                             url_validator=lambda u: u)
    res = await service.run_auto_sync_once(h, fetcher)
    assert "HTTP 500" in res["error"]
    assert db.model("m-synced")["input_price_per_1m"] == 1.0
    status = await service.read_status(db)
    assert "HTTP 500" in status["last_error"] and status["last_error_at"]
    assert alerts and alerts[0][0][1] == "warning"


async def test_reload_registries_uses_proxy_registry(db, monkeypatch):
    calls = []

    async def fake_load(dbx, registry, key, log=None):
        calls.append(("proxy", registry))

    async def fake_admin(h):
        calls.append(("admin", None))

    import wai.api.admin.models as models_mod
    import wai.proxy.registry as reg_mod

    monkeypatch.setattr(reg_mod, "load_db_into_registry", fake_load)
    monkeypatch.setattr(models_mod, "reload_admin_model_registry", fake_admin)
    reg = object()
    app = SimpleNamespace(state=SimpleNamespace(registry=reg))
    await service.reload_registries(SimpleNamespace(db=db, encryption_key=b"k"), app)
    assert calls == [("proxy", reg), ("admin", None)]

    hooked = []

    async def hook():
        hooked.append(1)

    await service.reload_registries(SimpleNamespace(db=db, reload_models=hook), None)
    assert hooked == [1]


# ------------------------------------------------------------------------------ fetcher


async def test_fetch_uses_etag_and_304_keeps_cache():
    seen = []

    def handler(request: httpx.Request):
        seen.append(request.headers.get("if-none-match"))
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, json=RAW, headers={"ETag": '"v1"'})

    f = CatalogFetcher("https://example.test/prices.json", transport=httpx.MockTransport(handler),
                       url_validator=lambda u: u)
    first = await f.get()
    assert first.etag == '"v1"' and first.get("gpt-4o")
    again = await f.get()  # fresh: no request
    assert again is first and len(seen) == 1
    third = await f.get(refresh=True)
    assert third is first and seen == [None, '"v1"']


async def test_fetch_rejects_oversize_and_bad_url():
    big = b"{" + b" " * 2048 + b"}"
    f = CatalogFetcher("https://example.test/p.json", max_bytes=1024, url_validator=lambda u: u,
                       transport=httpx.MockTransport(lambda r: httpx.Response(200, content=big)))
    with pytest.raises(CatalogError, match="larger"):
        await f.get()
    g = CatalogFetcher("http://10.0.0.1/p.json",
                       transport=httpx.MockTransport(lambda r: httpx.Response(200, json=RAW)))
    with pytest.raises(CatalogError, match="invalid pricing source_url"):
        await g.get()


async def test_fetch_local_file(tmp_path):
    p = tmp_path / "prices.json"
    p.write_text(json.dumps(RAW), encoding="utf-8")
    f = CatalogFetcher(local_path=str(p))
    cat = await f.get()
    assert cat.get("gpt-4o").input_per_1m == 2.5 and cat.source == f"file:{p}"
    with pytest.raises(CatalogError, match="cannot read"):
        await CatalogFetcher(local_path=str(tmp_path / "missing.json")).get()


# ------------------------------------------------------------------------------ migration


def test_migration_statements_are_idempotent_postgres():
    from pathlib import Path

    import wai.db.migrate as migrate

    sql = (Path(migrate.MIGRATIONS_DIR) / "0019_model_pricing_sync.up.sql").read_text(encoding="utf-8")
    stmts = split_sql_script(sql)
    assert len(stmts) == 4
    assert all("IF NOT EXISTS" in s for s in stmts[:3])
    assert "ON CONFLICT (key) DO NOTHING" in stmts[3]
    assert adapt_sql(stmts[3], "postgres") == stmts[3]


# ------------------------------------------------------------------------------ API


def _key(role: str) -> KeyInfo:
    return KeyInfo(id="k1", key_type="session_key", role=role, org_id="A", user_id="u1")


@pytest.fixture
def api(db, monkeypatch):
    audit = FakeAudit()
    reloads = []
    h = SimpleNamespace(db=db, audit_logger=audit)
    monkeypatch.setattr(pricing_api, "get_handler", lambda: h)

    async def fake_reload(hh, app=None):
        reloads.append(app)

    monkeypatch.setattr(service, "reload_registries", fake_reload)
    fetcher = CatalogFetcher(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=RAW)),
                             url_validator=lambda u: u)
    monkeypatch.setattr(pricing_api, "get_fetcher", lambda pc=None: fetcher)
    app = FastAPI()
    app.include_router(pricing_api.router, prefix="/api/v1")
    role = {"value": "system_admin"}
    app.dependency_overrides[auth_middleware] = lambda: _key(role["value"])
    client = TestClient(app)
    return SimpleNamespace(client=client, role=role, audit=audit, reloads=reloads, db=db)


@pytest.mark.parametrize("role", ["member", "team_admin", "org_admin"])
@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/v1/pricing/preview", None),
    ("POST", "/api/v1/pricing/apply", {"model_ids": ["m-synced"]}),
    ("GET", "/api/v1/pricing/status", None),
    ("GET", "/api/v1/pricing/lookup?name=gpt-4o", None),
    ("GET", "/api/v1/models/m-synced/pricing-settings", None),
    ("PUT", "/api/v1/models/m-synced/pricing-settings", {"pricing_source": "manual"}),
])
def test_api_requires_system_admin(api, role, method, path, body):
    api.role["value"] = role
    resp = api.client.request(method, path, json=body)
    assert resp.status_code == 403
    assert api.db.model("m-synced")["input_price_per_1m"] == 1.0


def test_api_preview_apply_status(api):
    r = api.client.get("/api/v1/pricing/preview")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["manual_locked"] == 1
    by_id = {row["model_id"]: row for row in body["rows"]}
    assert by_id["m-synced"]["catalog_input_per_1m"] == 2.5

    r = api.client.post("/api/v1/pricing/apply", json={"model_ids": ["m-synced", "m-manual"],
                                                       "lock_to_synced": True})
    assert r.status_code == 200
    assert {u["model_id"] for u in r.json()["updated"]} == {"m-synced", "m-manual"}
    assert api.db.model("m-manual")["pricing_source"] == "synced"
    assert len(api.reloads) == 1  # registry reloaded once after apply
    assert {e.resource_id for e in api.audit.events} == {"m-synced", "m-manual"}
    assert "0.165" in next(e.description for e in api.audit.events if e.resource_id == "m-manual")

    st = api.client.get("/api/v1/pricing/status").json()
    assert st["last_sync_at"] and st["synced_models"] == 2 and st["source_kind"] == "url"
    assert st["counts"]["manual_locked"] == 1 and st["last_error"] == ""


def test_api_apply_requires_ids_and_no_reload_when_nothing_changed(api):
    assert api.client.post("/api/v1/pricing/apply", json={"model_ids": []}).status_code == 400
    r = api.client.post("/api/v1/pricing/apply", json={"model_ids": ["m-local"]})
    assert r.status_code == 200 and r.json()["updated"] == []
    assert api.reloads == []


def test_api_pricing_settings_and_lookup(api):
    r = api.client.put("/api/v1/models/m-manual/pricing-settings",
                       json={"pricing_source": "synced", "pricing_key": " gpt-4o "})
    assert r.status_code == 200
    assert r.json() == {"model_id": "m-manual", "pricing_source": "synced", "pricing_key": "gpt-4o",
                        "pricing_synced_at": ""}
    assert api.audit.events[-1].action == "pricing.settings.update"
    assert api.client.put("/api/v1/models/m-manual/pricing-settings",
                          json={"pricing_source": "bogus"}).status_code == 422
    assert api.client.get("/api/v1/models/nope/pricing-settings").status_code == 404

    look = api.client.get("/api/v1/pricing/lookup", params={"model_id": "m-manual"}).json()
    assert look["found"] and look["match_key"] == "gpt-4o" and look["matched_via"] == "pricing_key"
    look = api.client.get("/api/v1/pricing/lookup", params={"name": "gpt-4o-mini", "provider": "azure"}).json()
    assert look["match_key"] == "azure/gpt-4o-mini" and look["input_per_1m"] == 0.165
    miss = api.client.get("/api/v1/pricing/lookup", params={"key": "nope"}).json()
    assert miss["found"] is False
    assert api.client.get("/api/v1/pricing/lookup").status_code == 400


def test_api_upstream_failure_is_502_and_recorded(api, monkeypatch):
    bad = CatalogFetcher(transport=httpx.MockTransport(lambda r: httpx.Response(503)),
                         url_validator=lambda u: u)
    monkeypatch.setattr(pricing_api, "get_fetcher", lambda pc=None: bad)
    r = api.client.get("/api/v1/pricing/preview")
    assert r.status_code == 502
    assert "HTTP 503" in api.client.get("/api/v1/pricing/status").json()["last_error"]


def test_schedule_auto_sync_is_noop_without_loop():
    pricing_pkg.schedule_auto_sync(SimpleNamespace(state=SimpleNamespace()), lambda: None)


def test_api_lookup_empty_key_uses_automatic_match(api):
    api.client.put("/api/v1/models/m-manual/pricing-settings", json={"pricing_key": "gpt-4o"})
    look = api.client.get("/api/v1/pricing/lookup", params={"model_id": "m-manual", "key": ""}).json()
    assert look["match_key"] == "azure/gpt-4o-mini" and look["matched_via"] == "provider_prefix"


def test_config_pricing_block():
    from wai.config.loader import _from_dict

    cfg = _from_dict({"pricing": {"auto_sync": "true", "local_path": " /x.json ", "auto_sync_interval_hours": "bad"}})
    assert cfg.pricing.auto_sync is True and cfg.pricing.local_path == "/x.json"
    assert cfg.pricing.auto_sync_interval_hours == 24.0
    assert _from_dict({}).pricing.auto_sync is False
    assert "BerriAI/litellm" in _from_dict({}).pricing.source_url
