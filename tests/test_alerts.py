"""Alerts: formatters, delivery, dispatcher routing/cooldown/queue, scheduled checks, admin API authz."""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

import wai.alerts as alerts_pkg
from wai.alerts import emit_alert
from wai.alerts.dispatcher import AlertDispatcher
from wai.alerts.formatters import (
    build_request,
    sign_body,
    slack_payload,
    teams_payload,
    verify_signature,
    webhook_body,
)
from wai.alerts.models import AlertChannel, AlertEvent, AlertRule, sanitize_data
from wai.alerts.scheduler import AlertScheduler, month_bucket
from wai.alerts.sender import check_url_syntax, deliver, mask_url
from wai.alerts.store import AlertStore
from wai.api.admin import alerts as api
from wai.api.admin.common import KeyInfo
from wai.db.dialect import split_sql_script

MIGRATION = Path(__file__).resolve().parents[1] / "src" / "wai" / "db" / "migrations" / "0018_alerts.up.sql"
KEY = os.urandom(32)


class FakeDB:
    """Async facade over in-memory SQLite, with the real 0018 migration applied."""

    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, deleted_at TEXT,
                                        monthly_spend_limit REAL NOT NULL DEFAULT 0);
            CREATE TABLE teams (id TEXT PRIMARY KEY, org_id TEXT, name TEXT, deleted_at TEXT,
                                monthly_spend_limit REAL NOT NULL DEFAULT 0);
            CREATE TABLE api_keys (id TEXT PRIMARY KEY, org_id TEXT, name TEXT, deleted_at TEXT,
                                   monthly_spend_limit REAL NOT NULL DEFAULT 0);
            CREATE TABLE usage_hourly (org_id TEXT, team_id TEXT DEFAULT '', user_id TEXT DEFAULT '',
                                       key_id TEXT, model_name TEXT, bucket_hour TEXT,
                                       request_count INTEGER DEFAULT 0, cost_sum REAL DEFAULT 0);
            CREATE TABLE request_logs (id TEXT PRIMARY KEY, created_at TEXT, org_id TEXT,
                                       model_name TEXT DEFAULT '', status_code INTEGER);
            INSERT INTO organizations (id, name) VALUES ('A', 'Org A'), ('B', 'Org B');
            """
        )
        for stmt in split_sql_script(MIGRATION.read_text(encoding="utf-8")):
            self.conn.execute(stmt)

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


_seq = 0


def _id() -> str:
    global _seq
    _seq += 1
    return f"00000000-0000-7000-8000-{_seq:012d}"


def ev(kind="error_rate.high", severity="warning", org_id="A", dedupe_key=None, now=None, **data) -> AlertEvent:
    return AlertEvent.create(
        id=_id(), kind=kind, severity=severity, title="T", message="M", org_id=org_id,
        data=data or None, dedupe_key=dedupe_key, now=now,
    )


# --- formatters ----------------------------------------------------------------------


def test_teams_payload_is_adaptive_card_with_fallback():
    p = teams_payload(ev(severity="critical", org_name="Org A", requests=5))
    assert p["type"] == "message"
    att = p["attachments"][0]
    assert att["contentType"] == "application/vnd.microsoft.card.adaptive"
    card = att["content"]
    assert card["type"] == "AdaptiveCard" and card["version"] == "1.4"
    assert card["fallbackText"].startswith("[Critical] T")
    facts = {f["title"]: f["value"] for f in card["body"][-1]["facts"]}
    assert facts["Organization"] == "Org A (A)"
    assert facts["Requests"] == "5"
    assert card["body"][0]["color"] == "Attention"


def test_slack_payload_blocks_and_escaping():
    e = AlertEvent.create(id="e1", kind="test", severity="warning", title="<b>", message="a & <c>")
    p = slack_payload(e)
    assert p["text"] == "[Warning] &lt;b&gt;: a &amp; &lt;c&gt;"
    assert [b["type"] for b in p["blocks"]] == ["header", "section", "section", "context"]
    assert "&lt;c&gt;" in p["blocks"][1]["text"]["text"]


def test_webhook_body_and_hmac_signature():
    e = ev(org_id=None, count=3)
    body = webhook_body(e)
    parsed = json.loads(body)
    assert set(parsed) == {"id", "kind", "severity", "title", "message", "org_id", "data", "created_at"}
    assert parsed["org_id"] is None and parsed["data"] == {"count": 3}
    b2, headers = build_request("webhook", e, secret="s3cret-s3cret-s3cret", timestamp=1700000000)
    assert b2 == body
    expected = "sha256=" + hmac.new(b"s3cret-s3cret-s3cret", body, hashlib.sha256).hexdigest()
    assert headers["X-WAI-Signature"] == expected == sign_body("s3cret-s3cret-s3cret", body)
    assert headers["X-WAI-Timestamp"] == "1700000000"
    assert verify_signature("s3cret-s3cret-s3cret", body, expected)
    assert not verify_signature("other", body, expected)
    _, th = build_request("teams", e)
    assert "X-WAI-Signature" not in th


def test_sanitize_drops_secrets_and_prompt_content():
    d = sanitize_data({"api_key": "x", "prompt": "hi", "messages": [1], "Authorization": "b", "model": "m", "n": 1})
    assert d == {"model": "m", "n": 1}


def test_url_masking_and_syntax():
    assert mask_url("https://hooks.slack.com/services/T000/B000/XXXXSECRET") == "hooks.slack.com/services/****"
    teams = "https://prod-01.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=1&sig=SECRET"
    masked = mask_url(teams)
    assert masked == "prod-01.westus.logic.azure.com/workflows/****"
    assert "SECRET" not in masked and "abc123" not in masked
    assert mask_url("https://example.com") == "example.com"
    # Long first segment could itself be a token: drop it.
    assert mask_url("https://x.io/" + "a" * 40 + "/b") == "x.io/****"
    with pytest.raises(ValueError):
        check_url_syntax("http://hooks.slack.com/x")
    with pytest.raises(ValueError):
        check_url_syntax("https://user:pw@hooks.slack.com/x")


# --- sender --------------------------------------------------------------------------


async def _ok_validate(url):
    return None


def _channel(kind="webhook", cid="c1", org_id="A", secret="s" * 20) -> AlertChannel:
    return AlertChannel(id=cid, org_id=org_id, name=cid, kind=kind, url=f"https://hooks.example.com/{cid}", secret=secret)


async def _no_sleep(_s):
    return None


async def test_deliver_retries_on_5xx_then_succeeds():
    calls = []

    def handler(request: httpx.Request):
        calls.append(request)
        return httpx.Response(503 if len(calls) == 1 else 200)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        res = await deliver(_channel(), ev(), client=client, validate=_ok_validate, sleep=_no_sleep)
    assert res["ok"] and res["attempts"] == 2 and res["status"] == 200
    sig = calls[0].headers["X-WAI-Signature"]
    assert verify_signature("s" * 20, calls[0].content, sig)


async def test_deliver_no_retry_on_4xx_and_never_raises():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        res = await deliver(_channel(), ev(), client=client, validate=_ok_validate, sleep=_no_sleep)
    assert not res["ok"] and res["error"] == "HTTP 404" and len(calls) == 1

    def boom(request):
        raise httpx.ConnectError("down", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(boom)) as client:
        res = await deliver(_channel(), ev(), client=client, validate=_ok_validate, sleep=_no_sleep)
    assert not res["ok"] and res["attempts"] == 3 and res["error"] == "ConnectError"


async def test_deliver_rejects_invalid_url_without_request():
    calls = []

    async def bad(url):
        raise ValueError("url must not point to a private address")

    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: calls.append(1) or httpx.Response(200))) as c:
        res = await deliver(_channel(), ev(), client=c, validate=bad)
    assert not res["ok"] and res["error"].startswith("invalid url") and calls == []


# --- dispatcher ----------------------------------------------------------------------


class Recorder:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def __call__(self, channel, event, client=None):
        self.sent.append((channel.id, event.id))
        return {"ok": True, "status": 200, "attempts": 1, "error": ""}


async def _add_channel(store: AlertStore, cid: str, org_id: str | None, kind="slack", enabled=True):
    await store.insert_channel(
        channel_id=cid, org_id=org_id, name=cid, kind=kind, url=f"https://hooks.slack.com/services/{cid}",
        url_hint="h", secret="", enabled=enabled, created_by="u",
    )


@pytest.fixture
async def env():
    db = FakeDB()
    store = AlertStore(db, KEY)
    await _add_channel(store, "orgA", "A")
    await _add_channel(store, "orgA-off", "A", enabled=False)
    await _add_channel(store, "orgB", "B")
    await _add_channel(store, "plat", None)
    rec = Recorder()
    clock = SimpleNamespace(now=datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc))
    d = AlertDispatcher(store, deliver_fn=rec, clock=lambda: clock.now)
    return SimpleNamespace(db=db, store=store, rec=rec, d=d, clock=clock)


def _sent_channels(rec):
    return sorted(c for c, _ in rec.sent)


async def test_routing_org_event_goes_to_org_channels_only(env):
    await env.d.process(ev(severity="warning", org_id="A"))
    assert _sent_channels(env.rec) == ["orgA"]
    row = env.db.rows("SELECT * FROM alert_events")[0]
    assert json.loads(row["delivered"])["orgA"]["ok"] is True


async def test_routing_critical_org_event_also_reaches_platform(env):
    await env.d.process(ev(severity="critical", org_id="A"))
    assert _sent_channels(env.rec) == ["orgA", "plat"]
    assert len(env.db.rows("SELECT * FROM alert_events")) == 1


async def test_routing_platform_event(env):
    await env.d.process(ev(kind="model.health", severity="warning", org_id=None))
    assert _sent_channels(env.rec) == ["plat"]


async def test_rule_disabled_and_severity_min(env):
    rule = AlertRule.default("error_rate.high", "A")
    await env.store.seed_rules("A", _id)
    rule.enabled = False
    await env.store.update_rule(rule)
    assert await env.d.process(ev(org_id="A")) is None
    assert env.rec.sent == [] and env.db.rows("SELECT * FROM alert_events") == []

    rule.enabled = True
    rule.severity_min = "critical"
    await env.store.update_rule(rule)
    assert await env.d.process(ev(org_id="A", severity="warning")) is None
    await env.d.process(ev(org_id="A", severity="critical"))
    assert _sent_channels(env.rec) == ["orgA", "plat"]


async def test_rule_channel_ids_restrict_targets(env):
    await _add_channel(env.store, "orgA2", "A")
    await env.store.seed_rules("A", _id)
    rule = await env.store.effective_rule("A", "error_rate.high")
    rule.channel_ids = ["orgA2"]
    await env.store.update_rule(rule)
    await env.d.process(ev(org_id="A"))
    assert _sent_channels(env.rec) == ["orgA2"]


async def test_cooldown_dedupe(env):
    await env.d.process(ev(org_id="A", dedupe_key="k1"))
    await env.d.process(ev(org_id="A", dedupe_key="k1"))  # inside 3600s cooldown
    await env.d.process(ev(org_id="A", dedupe_key="k2"))  # different key
    await env.d.process(ev(org_id="A"))  # no key: never suppressed
    assert len(env.rec.sent) == 3
    env.clock.now += timedelta(seconds=3601)
    await env.d.process(ev(org_id="A", dedupe_key="k1"))
    assert len(env.rec.sent) == 4


async def test_cooldown_survives_restart_via_event_log(env):
    await env.d.process(ev(org_id="A", dedupe_key="k1", now=env.clock.now))
    fresh = AlertDispatcher(env.store, deliver_fn=env.rec, clock=lambda: env.clock.now + timedelta(minutes=5))
    assert await fresh.process(ev(org_id="A", dedupe_key="k1")) is None
    assert len(env.rec.sent) == 1


async def test_queue_overflow_drops_oldest(env):
    d = AlertDispatcher(env.store, deliver_fn=env.rec, maxsize=3)
    events = [ev(org_id="A") for _ in range(5)]
    for e in events:
        d.submit(e)
    assert d.dropped == 2 and d.queued == 3
    await d.drain()
    assert [eid for _, eid in env.rec.sent] == [e.id for e in events[2:]]


async def test_emit_alert_is_noop_without_dispatcher_and_queues_with_one(env):
    alerts_pkg.set_dispatcher(None)
    emit_alert("error_rate.high", "warning", "t", "m", org_id="A")  # no dispatcher: no error
    alerts_pkg.set_dispatcher(env.d)
    try:
        emit_alert("error_rate.high", "warning", "t", "m", org_id="A", data={"token": "x", "n": 1}, dedupe_key="z")
        assert env.d.queued == 1
        await env.d.drain()
    finally:
        alerts_pkg.set_dispatcher(None)
    row = env.db.rows("SELECT * FROM alert_events")[0]
    assert json.loads(row["data"]) == {"n": 1} and row["dedupe_key"] == "z"


async def test_dispatcher_start_stop_processes_queue(env):
    await env.d.start()
    env.d.submit(ev(org_id="A"))
    await env.d.stop()
    assert _sent_channels(env.rec) == ["orgA"]


# --- scheduler -----------------------------------------------------------------------


class Emits:
    def __init__(self, dispatcher: AlertDispatcher | None = None) -> None:
        self.calls: list[dict] = []
        self.d = dispatcher

    def __call__(self, kind, severity, title, message, org_id=None, data=None, dedupe_key=None):
        self.calls.append({"kind": kind, "severity": severity, "org_id": org_id, "data": data, "dedupe_key": dedupe_key})
        if self.d is not None:
            self.d.submit(AlertEvent.create(id=_id(), kind=kind, severity=severity, title=title, message=message,
                                            org_id=org_id, data=data, dedupe_key=dedupe_key))


def _sched(db, emit, now):
    @contextlib.asynccontextmanager
    async def lock():
        yield True

    return AlertScheduler(db, emit, clock=lambda: now["t"], lock=lock)


def _usage(db, *, org="A", team="", key="k1", bucket, cost, model="gpt", n=1):
    db.conn.execute(
        "INSERT INTO usage_hourly (org_id, team_id, key_id, model_name, bucket_hour, request_count, cost_sum) VALUES (?,?,?,?,?,?,?)",
        (org, team, key, model, bucket, n, cost),
    )


async def test_budget_threshold_once_per_month_and_boundary(env):
    db = env.db
    db.conn.execute("UPDATE organizations SET monthly_spend_limit = 100 WHERE id = 'A'")
    _usage(db, bucket="2026-08-31T23:00:00+00:00", cost=500)  # previous UTC month: ignored
    _usage(db, bucket="2026-09-02T10:00:00+00:00", cost=85)
    now = {"t": datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)}
    assert month_bucket(now["t"]) == "2026-09-01T00:00:00+00:00"
    emits = Emits(env.d)
    s = _sched(db, emits, now)
    await s.run_once()
    assert [(c["severity"], c["dedupe_key"]) for c in emits.calls] == [("warning", "budget:org:A:2026-09:80")]
    await env.d.drain()
    await s.run_once()
    assert len(emits.calls) == 1  # once per month per threshold

    # A fresh scheduler (other instance / restart) sees the recorded event.
    s2 = _sched(db, emits, now)
    await s2.run_once()
    assert len(emits.calls) == 1

    _usage(db, key="k2", bucket="2026-09-09T10:00:00+00:00", cost=20)  # 105%
    await s2.run_once()
    assert emits.calls[-1]["severity"] == "critical"
    assert emits.calls[-1]["dedupe_key"] == "budget:org:A:2026-09:100"
    assert emits.calls[-1]["data"]["percent"] == 105.0
    await env.d.drain()
    await s2.run_once()
    assert len(emits.calls) == 2

    # New UTC month: spend resets, nothing until usage crosses again.
    now["t"] = datetime(2026, 10, 1, 0, 10, tzinfo=timezone.utc)
    await s2.run_once()
    assert len(emits.calls) == 2
    _usage(db, bucket="2026-10-01T00:00:00+00:00", cost=90)
    await s2.run_once()
    assert emits.calls[-1]["dedupe_key"] == "budget:org:A:2026-10:80"


async def test_budget_jump_straight_to_100_sends_only_critical(env):
    db = env.db
    db.conn.execute("INSERT INTO teams (id, org_id, name, monthly_spend_limit) VALUES ('T1', 'B', 'Team 1', 10)")
    db.conn.execute("INSERT INTO api_keys (id, org_id, name, monthly_spend_limit) VALUES ('k9', 'A', 'ci', 1)")
    _usage(db, org="B", team="T1", key="kx", bucket="2026-09-03T00:00:00+00:00", cost=12)
    _usage(db, org="A", key="k9", bucket="2026-09-03T00:00:00+00:00", cost=0.5)
    emits = Emits()
    await _sched(db, emits, {"t": datetime(2026, 9, 10, tzinfo=timezone.utc)}).run_once()
    got = sorted((c["dedupe_key"], c["severity"], c["org_id"]) for c in emits.calls)
    assert got == [("budget:team:T1:2026-09:100", "critical", "B")]


async def test_budget_custom_thresholds_and_disabled_rule(env):
    db = env.db
    db.conn.execute("UPDATE organizations SET monthly_spend_limit = 100")
    _usage(db, org="A", key="a", bucket="2026-09-03T00:00:00+00:00", cost=55)
    _usage(db, org="B", key="b", bucket="2026-09-03T00:00:00+00:00", cost=95)
    store = env.store
    await store.seed_rules("A", _id)
    await store.seed_rules("B", _id)
    ra = await store.effective_rule("A", "budget.threshold")
    ra.params = {"thresholds": [50, 90]}
    await store.update_rule(ra)
    rb = await store.effective_rule("B", "budget.threshold")
    rb.enabled = False
    await store.update_rule(rb)
    emits = Emits()
    await _sched(db, emits, {"t": datetime(2026, 9, 10, tzinfo=timezone.utc)}).run_once()
    assert [c["dedupe_key"] for c in emits.calls] == ["budget:org:A:2026-09:50"]


async def test_error_rate_check(env):
    db = env.db
    now = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
    rows = []
    for i in range(25):
        ts = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
        rows.append((f"a{i}", ts, "A", 500 if i < 5 else 200))
    for i in range(10):  # org B: all failing but below min_requests
        rows.append((f"b{i}", now.strftime("%Y-%m-%dT%H:%M:%S+00:00"), "B", 502))
    for i in range(30):  # old failures outside the window
        rows.append((f"o{i}", (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S+00:00"), "B", 500))
    db.conn.executemany("INSERT INTO request_logs (id, created_at, org_id, status_code) VALUES (?,?,?,?)", rows)
    emits = Emits()
    await _sched(db, emits, {"t": now}).run_once()
    assert len(emits.calls) == 1
    c = emits.calls[0]
    assert c["kind"] == "error_rate.high" and c["org_id"] == "A" and c["severity"] == "warning"
    assert c["data"]["error_rate_pct"] == 20.0 and c["dedupe_key"] == "error_rate:A"


async def test_daily_digest_disabled_by_default_then_once_per_day(env):
    db = env.db
    _usage(db, org="A", key="a", bucket="2026-09-10T01:00:00+00:00", cost=2.5, model="gpt-4o", n=7)
    now = {"t": datetime(2026, 9, 10, 4, 0, tzinfo=timezone.utc)}
    emits = Emits(env.d)
    s = _sched(db, emits, now)
    await s.run_once()
    assert emits.calls == []  # disabled by default

    await env.store.seed_rules("A", _id)
    r = await env.store.effective_rule("A", "digest.daily")
    r.enabled = True
    await env.store.update_rule(r)
    now["t"] = datetime(2026, 9, 10, 3, 0, tzinfo=timezone.utc)  # before 03:30 UTC
    await s.run_once()
    assert emits.calls == []
    now["t"] = datetime(2026, 9, 10, 3, 35, tzinfo=timezone.utc)
    await s.run_once()
    assert len(emits.calls) == 1
    c = emits.calls[0]
    assert c["dedupe_key"] == "digest:A:2026-09-10" and c["data"]["requests"] == 7
    assert c["data"]["top_models"] == ["gpt-4o: 7"]
    await env.d.drain()
    await _sched(db, emits, now).run_once()
    assert len(emits.calls) == 1


async def test_scheduler_skips_when_lock_not_acquired(env):
    @contextlib.asynccontextmanager
    async def lock():
        yield False

    emits = Emits()
    s = AlertScheduler(env.db, emits, lock=lock)
    assert await s.run_once() is False


# --- admin API -----------------------------------------------------------------------


def key(role: str, org: str = "A") -> KeyInfo:
    return KeyInfo(id="k", key_type="user", role=role, org_id=org, user_id="u1")


SYS = key("system_admin", org="Z")
ADMIN_A = key("org_admin", "A")


@pytest.fixture
async def h(monkeypatch, env):
    handler = SimpleNamespace(db=env.db, encryption_key=KEY)
    monkeypatch.setattr(api, "get_handler", lambda: handler)
    monkeypatch.setattr(api, "validate_channel_url", _ok_validate)
    monkeypatch.setattr(api, "get_dispatcher", lambda: env.d)
    return SimpleNamespace(handler=handler, env=env)


async def status_of(coro) -> int:
    try:
        await coro
        return 200
    except HTTPException as exc:
        return exc.status_code


async def test_api_create_channel_masks_url_and_returns_secret_once(h):
    url = "https://hooks.example.com/hook/abcdef123456?sig=TOPSECRET"
    resp = await api.create_channel(api.CreateChannelRequest(org_id="A", name="Ops", kind="webhook", url=url), ADMIN_A)
    assert resp.url_hint == "hooks.example.com/hook/****"
    assert resp.signing_secret and resp.signing_secret.startswith("whsec_") and resp.has_secret
    dumped = json.dumps(resp.model_dump())
    assert "TOPSECRET" not in dumped and "abcdef123456" not in dumped
    listed = await api.list_channels("A", ADMIN_A)
    ch = [c for c in listed.data if c.id == resp.id][0]
    assert ch.signing_secret is None and "TOPSECRET" not in json.dumps(ch.model_dump())
    # Encrypted at rest with channel-bound AAD.
    row = h.env.db.rows("SELECT url_enc FROM alert_channels WHERE id = ?", (resp.id,))[0]
    assert "TOPSECRET" not in row["url_enc"]
    assert (await h.env.store.get_channel(resp.id)).url == url

    rotated = await api.update_channel(resp.id, api.UpdateChannelRequest(rotate_secret=True), ADMIN_A)
    assert rotated.signing_secret and rotated.signing_secret != resp.signing_secret


async def test_api_rejects_bad_urls_and_kinds(h):
    assert await status_of(api.create_channel(
        api.CreateChannelRequest(org_id="A", name="x", kind="slack", url="http://hooks.slack.com/x"), ADMIN_A)) == 400
    assert await status_of(api.create_channel(
        api.CreateChannelRequest(org_id="A", name="x", kind="email", url="https://a.io/x"), ADMIN_A)) == 400


@pytest.mark.parametrize(
    "call",
    [
        lambda: api.list_channels(None, ADMIN_A),
        lambda: api.list_channels("B", ADMIN_A),
        lambda: api.list_rules(None, ADMIN_A),
        lambda: api.list_rules("B", ADMIN_A),
        lambda: api.list_events(None, None, None, None, None, ADMIN_A),
        lambda: api.list_events("B", None, None, None, None, ADMIN_A),
        lambda: api.update_rule("budget.threshold", api.UpdateRuleRequest(enabled=False), "B", ADMIN_A),
        lambda: api.update_rule("model.health", api.UpdateRuleRequest(enabled=False), None, ADMIN_A),
        lambda: api.create_channel(api.CreateChannelRequest(name="x", kind="slack", url="https://a.io/x"), ADMIN_A),
        lambda: api.create_channel(
            api.CreateChannelRequest(org_id="B", name="x", kind="slack", url="https://a.io/x"), ADMIN_A),
    ],
)
async def test_api_org_admin_cannot_touch_other_org_or_platform(h, call):
    assert await status_of(call()) == 403


@pytest.mark.parametrize("cid", ["orgB", "plat"])
async def test_api_org_admin_cannot_use_foreign_channels(h, cid):
    assert await status_of(api.update_channel(cid, api.UpdateChannelRequest(enabled=False), ADMIN_A)) == 404
    assert await status_of(api.delete_channel(cid, ADMIN_A)) == 404
    assert await status_of(api.test_channel(cid, ADMIN_A)) == 404
    assert h.env.rec.sent == []


async def test_api_system_admin_manages_platform_and_orgs(h):
    plat = await api.list_channels(None, SYS)
    assert [c.id for c in plat.data] == ["plat"]
    assert [c.id for c in (await api.list_channels("B", SYS)).data] == ["orgB"]
    rules = await api.list_rules(None, SYS)
    assert {r.kind for r in rules.data} == {
        "budget.threshold", "error_rate.high", "model.health", "deployment.circuit", "pricing.sync", "digest.daily"}
    pricing = [r for r in rules.data if r.kind == "pricing.sync"][0]
    assert pricing.enabled and pricing.cooldown_seconds == 21600
    org_rules = await api.list_rules("A", ADMIN_A)
    assert {r.kind for r in org_rules.data} == {"budget.threshold", "error_rate.high", "digest.daily"}
    digest = [r for r in org_rules.data if r.kind == "digest.daily"][0]
    assert digest.enabled is False and digest.params == {"hour_utc": 3, "minute_utc": 30}
    assert await status_of(api.update_channel("orgB", api.UpdateChannelRequest(enabled=False), SYS)) == 200


async def test_api_update_rule_validation(h):
    r = await api.update_rule(
        "error_rate.high",
        api.UpdateRuleRequest(enabled=True, cooldown_seconds=600, params={"threshold_pct": 25, "min_requests": 50},
                              channel_ids=["orgA"]),
        "A", ADMIN_A,
    )
    assert r.cooldown_seconds == 600 and r.params["threshold_pct"] == 25 and r.params["min_requests"] == 50
    assert r.params["window_minutes"] == 15 and r.channel_ids == ["orgA"]
    bad = [
        api.UpdateRuleRequest(channel_ids=["orgB"]),
        api.UpdateRuleRequest(channel_ids=["plat"]),
        api.UpdateRuleRequest(severity_min="loud"),
        api.UpdateRuleRequest(cooldown_seconds=-1),
        api.UpdateRuleRequest(params={"threshold_pct": 500}),
    ]
    for body in bad:
        assert await status_of(api.update_rule("error_rate.high", body, "A", ADMIN_A)) == 400
    b = await api.update_rule("budget.threshold", api.UpdateRuleRequest(params={"thresholds": [100, 50, 50]}), "A", ADMIN_A)
    assert b.params["thresholds"] == [50, 100]
    assert await status_of(api.update_rule("budget.threshold", api.UpdateRuleRequest(params={"thresholds": []}), "A", ADMIN_A)) == 400


async def test_api_test_channel_and_events_scoping(h):
    res = await api.test_channel("orgA", ADMIN_A)
    assert res.ok and res.status == 200 and res.event_id
    await h.env.d.process(ev(org_id="B", severity="warning"))
    await h.env.d.process(ev(kind="model.health", org_id=None, severity="warning"))
    a = await api.list_events("A", None, None, None, None, ADMIN_A)
    assert [e.kind for e in a.data] == ["test"]
    assert a.data[0].delivery[0].channel_id == "orgA" and a.data[0].delivery[0].ok
    everything = await api.list_events(None, None, None, None, None, SYS)
    assert len(everything.data) == 3
    only_b = await api.list_events("B", None, "warning", None, None, SYS)
    assert len(only_b.data) == 1 and only_b.data[0].org_id == "B"
    page = await api.list_events(None, None, None, 2, None, SYS)
    assert page.has_more and len(page.data) == 2
    rest = await api.list_events(None, None, None, 2, page.next_cursor, SYS)
    assert len(rest.data) == 1 and not rest.has_more


async def test_api_delete_channel_removes_it_from_rules(h):
    await api.update_rule("error_rate.high", api.UpdateRuleRequest(channel_ids=["orgA", "orgA-off"]), "A", ADMIN_A)
    await api.delete_channel("orgA", ADMIN_A)
    rule = await h.env.store.effective_rule("A", "error_rate.high")
    assert rule.channel_ids == ["orgA-off"]
    assert [c.id for c in (await api.list_channels("A", ADMIN_A)).data] == ["orgA-off"]


async def test_pricing_sync_kind_routes_to_platform(env):
    await env.d.process(ev(kind="pricing.sync", severity="warning", org_id=None, dedupe_key="pricing:auto"))
    await env.d.process(ev(kind="pricing.sync", severity="warning", org_id=None, dedupe_key="pricing:auto"))
    assert _sent_channels(env.rec) == ["plat"]  # second one inside the 6h cooldown


async def test_unknown_kind_is_delivered_to_platform_at_any_severity(env):
    await env.d.process(ev(kind="future.thing", severity="info", org_id="A"))
    assert _sent_channels(env.rec) == ["orgA", "plat"]
    await env.d.process(ev(kind="future.other", severity="info", org_id=None))
    assert _sent_channels(env.rec) == ["orgA", "plat", "plat"]
    assert len(env.db.rows("SELECT * FROM alert_events")) == 2
