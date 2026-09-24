"""Dashboard KPIs, request-log live tail and onboarding status.

SQL runs against in-memory sqlite. sqlite has no percentile_cont, so the fake DB rewrites
the PostgreSQL ordered-set aggregate to a MAX() stand-in; the real Postgres text is checked
separately (placeholder numbering after adapt_sql).
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from wai.api.admin import dashboard, onboarding, usage
from wai.api.admin import repository as repo
from wai.api.admin.common import KeyInfo
from wai.db.dialect import adapt_sql

_PCT_RE = re.compile(r"percentile_cont\(([0-9.]+)\) WITHIN GROUP \(ORDER BY r\.latency_ms\)")

SCHEMA = """
CREATE TABLE organizations (id TEXT PRIMARY KEY, monthly_spend_limit REAL NOT NULL DEFAULT 0);
CREATE TABLE teams (id TEXT PRIMARY KEY, org_id TEXT, monthly_spend_limit REAL NOT NULL DEFAULT 0,
                    deleted_at TEXT);
CREATE TABLE team_memberships (id TEXT, team_id TEXT, user_id TEXT);
CREATE TABLE org_memberships (id TEXT, org_id TEXT, user_id TEXT);
CREATE TABLE models (id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
CREATE TABLE api_keys (id TEXT PRIMARY KEY, org_id TEXT, team_id TEXT, user_id TEXT,
                       key_hint TEXT DEFAULT '', monthly_spend_limit REAL NOT NULL DEFAULT 0,
                       deleted_at TEXT);
CREATE TABLE request_logs (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, org_id TEXT NOT NULL, key_id TEXT,
    model_name TEXT NOT NULL DEFAULT '', requested_model TEXT NOT NULL DEFAULT '',
    status_code INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0, cache_hit INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT ''
);
"""


class FakeDB:
    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.queries: list[str] = []

    def _sql(self, sql: str) -> str:
        self.queries.append(sql)
        return _PCT_RE.sub("MAX(r.latency_ms)", sql)

    async def fetchall(self, sql, params=()):
        return [dict(r) for r in self.conn.execute(self._sql(sql), tuple(params)).fetchall()]

    async def fetchone(self, sql, params=()):
        r = self.conn.execute(self._sql(sql), tuple(params)).fetchone()
        return dict(r) if r else None

    def run(self, sql, params=()):
        self.conn.execute(sql, params)


def ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")


T0 = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
_seq = [0]


def add_log(db: FakeDB, at: datetime, *, org="A", key="kA1", status=200, pt=10, ct=5,
            cost=0.01, latency=100, cache=0, rid: str | None = None) -> str:
    _seq[0] += 1
    rid = rid or f"r{_seq[0]:05d}"
    db.run(
        """INSERT INTO request_logs (id, created_at, org_id, key_id, status_code, prompt_tokens,
               completion_tokens, cost_usd, latency_ms, cache_hit, model_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'm')""",
        (rid, ts(at), org, key, status, pt, ct, cost, latency, cache),
    )
    return rid


@pytest.fixture
def h(monkeypatch):
    db = FakeDB()
    db.conn.executescript(
        """
        INSERT INTO organizations (id) VALUES ('A'), ('B');
        INSERT INTO teams (id, org_id) VALUES ('T1', 'A'), ('T2', 'A');
        INSERT INTO team_memberships VALUES ('tm1', 'T1', 'u-t1');
        INSERT INTO api_keys (id, org_id, team_id, user_id) VALUES
            ('kA1', 'A', 'T1', 'u1'), ('kA2', 'A', 'T2', 'u2'), ('kB', 'B', NULL, 'u9');
        """
    )
    handler = SimpleNamespace(db=db, health_checker=None)
    for mod in (dashboard, usage, onboarding):
        monkeypatch.setattr(mod, "get_handler", lambda: handler)
    return handler


def key(role: str, org: str = "A", user: str = "u1", team: str = "") -> KeyInfo:
    return KeyInfo(id="k", key_type="user", role=role, org_id=org, user_id=user, team_id=team)


# --- window / granularity / gap filling -----------------------------------------------------


def test_window_defaults_to_last_24h():
    now = datetime(2026, 9, 2, 10, 30, 15, 999, tzinfo=timezone.utc)
    f, t = dashboard.kpi_window("", "", now=now)
    assert t == now.replace(microsecond=0)
    assert t - f == timedelta(hours=24)


def test_window_parses_and_normalizes_to_utc():
    f, t = dashboard.kpi_window("2026-09-01T02:00:00+02:00", "2026-09-01T10:00:00Z")
    assert f == datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)
    assert t == datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)
    f, _ = dashboard.kpi_window("", "2026-09-01T10:00:00Z")
    assert f == datetime(2026, 8, 31, 10, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "f,t",
    [
        ("2026-09-02T00:00:00Z", "2026-09-01T00:00:00Z"),
        ("2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
        ("2025-01-01T00:00:00Z", "2026-09-01T00:00:00Z"),
        ("garbage", "2026-09-01T00:00:00Z"),
        ("2026-09-01T00:00:00Z", "nope"),
    ],
)
def test_window_rejects_bad_ranges(f, t):
    with pytest.raises(HTTPException) as exc:
        dashboard.kpi_window(f, t)
    assert exc.value.status_code == 400


def test_window_allows_exactly_366_days():
    f, t = dashboard.kpi_window("2025-09-01T00:00:00Z", "2026-09-02T00:00:00Z")
    assert t - f == timedelta(days=366)


def test_granularity_boundary():
    assert dashboard.kpi_granularity(T0, T0 + timedelta(hours=48)) == "hour"
    assert dashboard.kpi_granularity(T0, T0 + timedelta(hours=48, seconds=1)) == "day"


def test_series_gap_fill_hourly_with_partial_first_bucket():
    f = T0 + timedelta(minutes=30)
    t = T0 + timedelta(hours=3)
    rows = [{"bucket": "2026-09-01T13", "requests": 4, "errors": 1, "tokens": 40,
             "cost_usd": 0.5, "latency_p95_ms": 123.6}]
    series = dashboard.kpi_series(rows, f, t, "hour")
    assert [p.bucket for p in series] == [
        "2026-09-01T12:00:00+00:00", "2026-09-01T13:00:00+00:00", "2026-09-01T14:00:00+00:00",
    ]
    assert [p.requests for p in series] == [0, 4, 0]
    assert series[1].latency_p95_ms == 124 and series[1].cost_usd == 0.5
    assert series[0].latency_p95_ms == 0


def test_series_gap_fill_daily():
    f = datetime(2026, 9, 1, 6, tzinfo=timezone.utc)
    t = datetime(2026, 9, 4, 0, tzinfo=timezone.utc)
    rows = [{"bucket": "2026-09-03", "requests": 2, "errors": 0, "tokens": 1,
             "cost_usd": 0, "latency_p95_ms": None}]
    series = dashboard.kpi_series(rows, f, t, "day")
    assert [p.bucket[:10] for p in series] == ["2026-09-01", "2026-09-02", "2026-09-03"]
    assert [p.requests for p in series] == [0, 0, 2]


def test_totals_rates_and_empty():
    empty = dashboard.kpi_totals({"requests": 0, "latency_p50_ms": None})
    assert empty.error_rate == 0 and empty.cache_hit_rate == 0 and empty.latency_p50_ms == 0
    t = dashboard.kpi_totals({"requests": 8, "errors": 2, "cache_hits": 4, "tokens": 100,
                              "cost_usd": 1.25, "latency_p50_ms": 50.4, "latency_p95_ms": 99.5})
    assert t.error_rate == 0.25 and t.cache_hit_rate == 0.5
    assert (t.latency_p50_ms, t.latency_p95_ms) == (50, 100)


# --- SQL -----------------------------------------------------------------------------------


def test_postgres_sql_placeholders_match_params():
    for org, team, user in [("", "", ""), ("A", "", ""), ("A", "T1", ""), ("A", "", "u1")]:
        sql, params = repo.build_kpi_totals_sql(org, team, user, "a", "b")
        pg = adapt_sql(sql, "postgres")
        assert "?" not in pg
        assert len(set(re.findall(r"\$(\d+)", pg))) == len(params)
        assert "percentile_cont(0.5) WITHIN GROUP (ORDER BY r.latency_ms)" in pg
        assert ("JOIN api_keys" in sql) == bool(team or user)
        assert ("r.org_id" in sql) == bool(org)
        sql, params = repo.build_kpi_series_sql(org, team, user, "a", "b", "day")
        pg = adapt_sql(sql, "postgres")
        assert len(set(re.findall(r"\$(\d+)", pg))) == len(params)
        assert "SUBSTR(r.created_at, 1, 10)" in pg
    pg = adapt_sql(repo.ONBOARDING_STATUS_SQL, "postgres")
    assert "$6" in pg and "$7" not in pg


# --- /dashboard/kpis -----------------------------------------------------------------------


def _seed_kpis(db: FakeDB) -> None:
    # current window [12:00, 15:00)
    add_log(db, T0 + timedelta(minutes=5), latency=100)
    add_log(db, T0 + timedelta(minutes=10), status=500, latency=900, pt=0, ct=0, cost=0)
    add_log(db, T0 + timedelta(hours=2, minutes=59, seconds=59), cache=1, latency=10)
    add_log(db, T0 + timedelta(hours=1), key="kA2", latency=50)  # other team / user
    add_log(db, T0 + timedelta(hours=1), org="B", key="kB")  # other org
    add_log(db, T0 + timedelta(hours=3), latency=5000)  # == to: excluded
    # previous window [09:00, 12:00)
    add_log(db, T0 - timedelta(hours=1), status=429)
    add_log(db, T0 - timedelta(hours=3, seconds=1))  # before previous window


async def _kpis(k: KeyInfo):
    return await dashboard.dashboard_kpis(
        from_=ts(T0), to=ts(T0 + timedelta(hours=3)), key_info=k,
    )


async def test_kpis_org_admin(h):
    _seed_kpis(h.db)
    r = await _kpis(key("org_admin"))
    assert r.granularity == "hour"
    c = r.current
    assert (c.requests, c.errors, c.cache_hits) == (4, 1, 1)
    assert c.error_rate == 0.25 and c.cache_hit_rate == 0.25
    assert c.tokens == 45 and c.cost_usd == pytest.approx(0.03)
    assert c.latency_p95_ms == 900  # MAX stand-in for the sqlite run
    assert (r.previous.requests, r.previous.errors) == (1, 1)
    assert [p.bucket for p in r.series] == [
        "2026-09-01T12:00:00+00:00", "2026-09-01T13:00:00+00:00", "2026-09-01T14:00:00+00:00",
    ]
    assert [p.requests for p in r.series] == [2, 1, 1]
    assert [p.errors for p in r.series] == [1, 0, 0]


async def test_kpis_system_admin_scoped_to_own_org_like_stats(h):
    _seed_kpis(h.db)
    assert (await _kpis(key("system_admin", org="A"))).current.requests == 4
    # Without an org of their own, a system admin sees every org.
    assert (await _kpis(key("system_admin", org=""))).current.requests == 5


async def test_kpis_team_admin_resolves_team_like_stats(h):
    _seed_kpis(h.db)
    r = await _kpis(key("team_admin", user="u-t1"))  # member of T1 via team_memberships
    assert r.current.requests == 3
    r = await _kpis(key("team_admin", user="", team="T2"))  # team key
    assert r.current.requests == 1


async def test_kpis_team_admin_without_team_gets_zeros(h):
    _seed_kpis(h.db)
    r = await _kpis(key("team_admin", user="nobody"))
    assert r.current.requests == 0 and len(r.series) == 3
    assert not any("request_logs" in q for q in h.db.queries)


async def test_kpis_member_sees_own_keys_only(h):
    _seed_kpis(h.db)
    assert (await _kpis(key("member", user="u2"))).current.requests == 1
    assert (await _kpis(key("member", user="u1"))).current.requests == 3
    # A member key with no user (e.g. service account) sees nothing rather than the org.
    assert (await _kpis(key("member", user=""))).current.requests == 0


async def test_kpis_daily_granularity(h):
    add_log(h.db, T0)
    add_log(h.db, T0 + timedelta(days=2))
    r = await dashboard.dashboard_kpis(
        from_=ts(T0 - timedelta(days=1)), to=ts(T0 + timedelta(days=3)), key_info=key("org_admin"),
    )
    assert r.granularity == "day"
    assert [p.bucket[:10] for p in r.series] == ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]
    assert [p.requests for p in r.series] == [0, 1, 0, 1, 0]  # to = 09-04 12:00


# --- /usage/request-logs live tail ---------------------------------------------------------


async def _logs(k: KeyInfo, **kw):
    params = dict(limit=50, before="", before_id="", after="", after_id="", model="",
                  status="", key_id="", from_="", to="")
    params.update(kw)
    return await usage.list_request_logs(key_info=k, **params)


async def test_request_logs_after_cursor(h):
    same = T0 + timedelta(minutes=1)
    add_log(h.db, T0, rid="0001")
    add_log(h.db, same, rid="0002")
    add_log(h.db, same, rid="0003")
    add_log(h.db, T0 + timedelta(minutes=2), rid="0004")
    admin = key("org_admin")

    full = await _logs(admin)
    assert [r.id for r in full.data] == ["0004", "0003", "0002", "0001"]
    assert (full.latest_created_at, full.latest_id) == (ts(T0 + timedelta(minutes=2)), "0004")

    r = await _logs(admin, after=ts(same), after_id="0002")
    assert [x.id for x in r.data] == ["0004", "0003"]
    assert r.latest_id == "0004"

    r = await _logs(admin, after=ts(same))
    assert [x.id for x in r.data] == ["0004"]

    r = await _logs(admin, after=full.latest_created_at, after_id=full.latest_id)
    assert r.data == [] and r.latest_created_at == "" and r.latest_id == ""

    # Combines with other filters and scope.
    r = await _logs(key("member", user="u2"), after=ts(T0 - timedelta(hours=1)))
    assert r.data == []

    with pytest.raises(HTTPException):
        await _logs(admin, after="not-a-date")


# --- /onboarding/status --------------------------------------------------------------------


async def test_onboarding_status_progression(h):
    db = h.db
    db.run("DELETE FROM api_keys")
    k = key("member")
    s = await onboarding.onboarding_status(key_info=k)
    assert s.model_dump() == dict.fromkeys(
        ["has_models", "has_keys", "has_requests", "has_budget", "has_members"], False,
    )
    db.run("INSERT INTO models (id, is_active) VALUES ('m1', 0)")
    db.run("INSERT INTO models (id, deleted_at) VALUES ('m2', '2026-01-01')")
    assert not (await onboarding.onboarding_status(key_info=k)).has_models
    db.run("INSERT INTO models (id) VALUES ('m3')")
    db.run("INSERT INTO api_keys (id, org_id, deleted_at, monthly_spend_limit) VALUES ('d', 'A', 'x', 5)")
    db.run("INSERT INTO api_keys (id, org_id) VALUES ('kb', 'B')")
    add_log(db, T0, org="B", key="kb")
    db.run("INSERT INTO org_memberships VALUES ('om1', 'A', 'u1'), ('om2', 'B', 'u2'), ('om3', 'B', 'u3')")
    s = await onboarding.onboarding_status(key_info=k)
    assert s.has_models and not s.has_keys and not s.has_requests
    assert not s.has_budget and not s.has_members  # deleted key's limit does not count

    db.run("INSERT INTO api_keys (id, org_id) VALUES ('ka', 'A')")
    add_log(db, T0, org="A", key="ka")
    db.run("INSERT INTO org_memberships VALUES ('om4', 'A', 'u4')")
    db.run("UPDATE teams SET monthly_spend_limit = 10 WHERE id = 'T2'")
    s = await onboarding.onboarding_status(key_info=k)
    assert s.has_keys and s.has_requests and s.has_budget and s.has_members


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE organizations SET monthly_spend_limit = 1 WHERE id = 'A'",
        "UPDATE api_keys SET monthly_spend_limit = 1 WHERE id = 'kA1'",
    ],
)
async def test_onboarding_budget_sources(h, sql):
    assert not (await onboarding.onboarding_status(key_info=key("org_admin"))).has_budget
    h.db.run(sql)
    assert (await onboarding.onboarding_status(key_info=key("org_admin"))).has_budget
    # System admins get their own org's status.
    assert not (await onboarding.onboarding_status(key_info=key("system_admin", org="B"))).has_budget
