"""Key cache: limits loaded on create/login, invalidation, expiry, logout, 429 limits (no DB)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from wai.api.admin import auth as auth_mod
from wai.api.admin import handler as handler_mod
from wai.api.admin import keys as keys_mod
from wai.api.admin import repository as repo
from wai.api.admin.common import (
    KEY_TYPE_SA,
    KEY_TYPE_SESSION,
    KEY_TYPE_TEAM,
    KEY_TYPE_USER,
    KeyInfo,
    ROLE_ORG_ADMIN,
    _seconds_until_window_reset,
    budget_exceeded,
    generate_key,
    hash_key,
    limit_reached,
)
from wai.api.admin.handler import (
    Handler,
    KeyCache,
    authenticate_bearer,
    is_key_expired,
    key_info_from_row,
    parse_key_expiry,
)


# --- fakes -----------------------------------------------------------------


class FakeKeyStore:
    """In-memory stand-in for the repo functions touching api_keys / load_active_keys."""

    def __init__(self) -> None:
        self.keys: dict[str, dict[str, Any]] = {}
        self.org = {
            "org_daily_token_limit": 1000,
            "org_monthly_token_limit": 50000,
            "org_requests_per_minute": 30,
            "org_requests_per_day": 900,
            "org_monthly_spend_limit": 25.0,
            "org_guardrail_pii": 1,
            "org_guardrail_tool_denylist": "shell",
        }
        self.teams: dict[str, dict[str, Any]] = {}
        self.users: dict[str, dict[str, Any]] = {
            "u1": {"id": "u1", "email": "u1@x", "display_name": "U1", "is_system_admin": 0},
        }
        self.memberships: dict[tuple[str, str], str] = {("u1", "o1"): "member"}
        self.fail = False
        self.load_calls: list[dict[str, Any]] = []
        self._n = 0

    def add(self, **kw: Any) -> dict[str, Any]:
        self._n += 1
        row = {
            "id": kw.pop("id", f"k{self._n}"),
            "key_hash": kw.pop("key_hash", f"h{self._n}"),
            "key_hint": "wa_uk_...",
            "key_type": KEY_TYPE_USER,
            "name": "n",
            "org_id": "o1",
            "team_id": None,
            "user_id": "u1",
            "service_account_id": None,
            "daily_token_limit": 0,
            "monthly_token_limit": 0,
            "requests_per_minute": 0,
            "requests_per_day": 0,
            "monthly_spend_limit": 0.0,
            "expires_at": None,
            "created_by": "u1",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            "deleted": False,
        }
        row.update(kw)
        self.keys[row["id"]] = row
        return row

    def _joined(self, k: dict[str, Any]) -> dict[str, Any] | None:
        if k["deleted"]:
            return None
        user = self.users.get(k["user_id"]) if k["user_id"] else None
        if k["user_id"] and (user is None or user.get("deleted")):
            return None
        team = self.teams.get(k["team_id"]) if k["team_id"] else None
        if team and team.get("deleted"):
            return None
        role = self.memberships.get((k["user_id"], k["org_id"])) if k["user_id"] else None
        if k["key_type"] in (KEY_TYPE_USER, KEY_TYPE_SESSION) and not role and not (user or {}).get("is_system_admin"):
            return None
        row = {kk: v for kk, v in k.items() if kk != "deleted"}
        row.update(self.org)
        for f in ("daily_token_limit", "monthly_token_limit", "requests_per_minute", "requests_per_day", "monthly_spend_limit"):
            row[f"team_{f}"] = (team or {}).get(f, 0)
        row["is_system_admin"] = (user or {}).get("is_system_admin", 0)
        row["membership_role"] = role
        return row

    async def load_active_keys(self, _db: Any, **filters: Any) -> list[dict[str, Any]]:
        self.load_calls.append(filters)
        if self.fail:
            raise RuntimeError("db down")
        cols = {"key_id": "id"}
        out = []
        for k in self.keys.values():
            if any(v is not None and k[cols.get(f, f)] != v for f, v in filters.items()):
                continue
            row = self._joined(k)
            if row:
                out.append(row)
        return out

    async def load_all_active_keys(self, db: Any) -> list[dict[str, Any]]:
        return await self.load_active_keys(db)

    async def create_api_key(self, _db: Any, params: dict[str, Any]) -> dict[str, Any]:
        return self.add(**{k: v for k, v in params.items()})

    async def get_api_key(self, _db: Any, key_id: str) -> dict[str, Any] | None:
        k = self.keys.get(key_id)
        return None if not k or k["deleted"] else dict(k)

    async def update_api_key(self, _db: Any, key_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        k = self.keys.get(key_id)
        if not k or k["deleted"]:
            raise repo.NotFoundError(key_id)
        k.update(fields)
        return dict(k)

    async def delete_api_key(self, _db: Any, key_id: str) -> None:
        k = self.keys.get(key_id)
        if not k or k["deleted"]:
            raise repo.NotFoundError(key_id)
        k["deleted"] = True

    async def revoke_user_sessions(self, _db: Any, user_id: str) -> None:
        for k in self.keys.values():
            if k["user_id"] == user_id and k["key_type"] == KEY_TYPE_SESSION:
                k["deleted"] = True

    async def get_user(self, _db: Any, user_id: str) -> dict[str, Any] | None:
        return self.users.get(user_id)

    async def get_user_org_role(self, _db: Any, user_id: str, org_id: str) -> str:
        role = self.memberships.get((user_id, org_id))
        if role is None:
            raise repo.NotFoundError("membership")
        return role


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeKeyStore:
    s = FakeKeyStore()
    for name in (
        "load_active_keys", "load_all_active_keys", "create_api_key", "get_api_key",
        "update_api_key", "delete_api_key", "revoke_user_sessions", "get_user", "get_user_org_role",
    ):
        monkeypatch.setattr(repo, name, getattr(s, name))
    return s


@pytest.fixture
def h(monkeypatch: pytest.MonkeyPatch) -> Handler:
    handler = Handler(db=None, encryption_key=b"k" * 32)  # type: ignore[arg-type]
    monkeypatch.setattr(handler_mod, "_handler", handler)
    return handler


def _req(token: str = "") -> Request:
    headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers, "query_string": b""})


def _info(**kw: Any) -> KeyInfo:
    base = dict(id="k", key_type=KEY_TYPE_USER, role="member", org_id="o1", user_id="u1")
    base.update(kw)
    return KeyInfo(**base)


# --- expiry ------------------------------------------------------------------


def test_parse_key_expiry_variants():
    assert parse_key_expiry(None) is None
    assert parse_key_expiry("") is None
    assert parse_key_expiry("garbage") is None
    z = parse_key_expiry("2026-01-02T03:04:05Z")
    assert z == datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    naive = parse_key_expiry("2026-01-02T03:04:05")
    assert naive is not None and naive.tzinfo is not None
    assert parse_key_expiry(datetime(2026, 1, 1)).tzinfo is not None


def test_cache_get_rejects_and_evicts_expired_keys():
    c = KeyCache()
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    c.set("old", _info(id="a", expires_at=past))
    c.set("naive_old", _info(id="b", expires_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)))
    c.set("ok", _info(id="c", expires_at=future))
    c.set("forever", _info(id="d"))
    assert c.get("old") is None
    assert c.get("naive_old") is None
    assert c.get("ok") is not None
    assert c.get("forever") is not None
    assert len(c) == 2  # expired entries evicted on lookup


def test_is_key_expired_boundary():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert is_key_expired(_info(expires_at=now), now=now)
    assert not is_key_expired(_info(expires_at=now + timedelta(seconds=1)), now=now)


async def test_authenticate_bearer_rejects_expired_key(h: Handler):
    token = generate_key(KEY_TYPE_USER)
    kh = hash_key(token, h.hmac_secret)
    h.key_cache.set(kh, _info(expires_at=datetime.now(timezone.utc) - timedelta(seconds=5)))
    with pytest.raises(HTTPException) as ei:
        await authenticate_bearer(_req(token))
    assert ei.value.status_code == 401
    h.key_cache.set(kh, _info(expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    assert (await authenticate_bearer(_req(token))).id == "k"


# --- row -> KeyInfo ---------------------------------------------------------------


def test_key_info_from_row_carries_all_limits(store: FakeKeyStore):
    store.teams["t1"] = {"daily_token_limit": 7, "requests_per_minute": 3, "monthly_spend_limit": 4.5}
    row = store._joined(store.add(
        key_type=KEY_TYPE_TEAM, user_id=None, team_id="t1", requests_per_minute=5, requests_per_day=50,
        daily_token_limit=100, monthly_token_limit=2000, monthly_spend_limit=9.5,
        expires_at="2030-01-01T00:00:00+00:00",
    ))
    info = key_info_from_row(row)
    assert info.role == "team_admin"
    assert (info.requests_per_minute, info.requests_per_day) == (5, 50)
    assert (info.daily_token_limit, info.monthly_token_limit) == (100, 2000)
    assert info.monthly_spend_limit == 9.5
    assert info.expires_at == datetime(2030, 1, 1, tzinfo=timezone.utc)
    assert info.org_requests_per_minute == 30 and info.org_monthly_spend_limit == 25.0
    assert info.org_guardrail_pii is True and info.org_guardrail_tool_denylist == "shell"
    assert info.team_daily_token_limit == 7 and info.team_requests_per_minute == 3
    assert info.team_monthly_spend_limit == 4.5


def test_key_info_from_row_roles():
    base = {"id": "k", "org_id": "o", "key_hash": "h"}
    assert key_info_from_row({**base, "key_type": KEY_TYPE_SA}).role == ROLE_ORG_ADMIN
    assert key_info_from_row({**base, "key_type": KEY_TYPE_SA, "team_id": "t"}).role == "team_admin"
    assert key_info_from_row({**base, "key_type": KEY_TYPE_USER, "membership_role": "org_admin"}).role == "org_admin"
    assert key_info_from_row({**base, "key_type": KEY_TYPE_SESSION, "is_system_admin": 1}).role == "system_admin"


# --- eviction helpers ------------------------------------------------------------------


def test_evict_by_scope():
    c = KeyCache()
    c.set("a", _info(id="a", user_id="u1", org_id="o1", team_id="t1"))
    c.set("b", _info(id="b", user_id="u1", org_id="o2", key_type=KEY_TYPE_SESSION))
    c.set("c", _info(id="c", user_id="u2", org_id="o1", team_id="t1"))
    c.set("d", _info(id="d", user_id="", org_id="o2", key_type=KEY_TYPE_SA, service_account_id="s1"))
    assert c.evict_by_user("u1", frozenset({KEY_TYPE_SESSION})) == 1
    assert c.get("b") is None and c.get("a") is not None
    assert c.evict(user_id="u1", org_id="o2") == 0
    assert c.evict_by_team("t1") == 2
    assert c.evict(service_account_id="s1") == 1
    assert len(c) == 0
    with pytest.raises(ValueError):
        c.evict()


# --- Handler.refresh_keys / revoke_user_sessions -------------------------------------------


async def test_seed_and_refresh_reflect_limit_changes(h: Handler, store: FakeKeyStore):
    k = store.add(requests_per_minute=10)
    await h.seed_key_cache()
    assert h.key_cache.get(k["key_hash"]).requests_per_minute == 10
    k["requests_per_minute"] = 2
    store.org["org_requests_per_day"] = 5
    assert await h.refresh_keys(key_id=k["id"]) == 1
    info = h.key_cache.get(k["key_hash"])
    assert info.requests_per_minute == 2 and info.org_requests_per_day == 5


async def test_refresh_evicts_revoked_or_orphaned_keys(h: Handler, store: FakeKeyStore):
    k1 = store.add(user_id="u1")
    store.users["u2"] = {"id": "u2", "is_system_admin": 0}
    store.memberships[("u2", "o1")] = "member"
    k2 = store.add(user_id="u2")
    await h.seed_key_cache()
    # member removed from org -> their user keys disappear from the cache
    del store.memberships[("u1", "o1")]
    await h.refresh_keys(user_id="u1", org_id="o1")
    assert h.key_cache.get(k1["key_hash"]) is None
    assert h.key_cache.get(k2["key_hash"]) is not None
    # user deleted
    store.users["u2"]["deleted"] = True
    await h.refresh_keys(user_id="u2")
    assert h.key_cache.get(k2["key_hash"]) is None


async def test_refresh_team_scope_only_touches_team(h: Handler, store: FakeKeyStore):
    store.teams["t1"] = {"requests_per_minute": 1}
    tk = store.add(key_type=KEY_TYPE_TEAM, user_id=None, team_id="t1")
    uk = store.add()
    await h.seed_key_cache()
    store.teams["t1"]["requests_per_minute"] = 99
    await h.refresh_keys(team_id="t1")
    assert h.key_cache.get(tk["key_hash"]).team_requests_per_minute == 99
    assert h.key_cache.get(uk["key_hash"]) is not None
    store.teams["t1"]["deleted"] = True
    await h.refresh_keys(team_id="t1")
    assert h.key_cache.get(tk["key_hash"]) is None
    assert h.key_cache.get(uk["key_hash"]) is not None


async def test_refresh_fails_closed_on_db_error(h: Handler, store: FakeKeyStore):
    k = store.add()
    other = store.add(user_id="u1", org_id="o1", id="other")
    await h.seed_key_cache()
    store.fail = True
    assert await h.refresh_keys(key_id=k["id"]) == 0
    assert h.key_cache.get(k["key_hash"]) is None
    assert h.key_cache.get(other["key_hash"]) is not None


async def test_revoke_user_sessions_evicts_cached_sessions(h: Handler, store: FakeKeyStore):
    s = store.add(key_type=KEY_TYPE_SESSION)
    uk = store.add()
    await h.seed_key_cache()
    await h.revoke_user_sessions("u1")
    assert h.key_cache.get(s["key_hash"]) is None
    assert h.key_cache.get(uk["key_hash"]) is not None


# --- endpoints (called directly, repo faked) ----------------------------------------------------


async def test_create_key_caches_limits_and_persists_spend(h: Handler, store: FakeKeyStore):
    caller = _info(role="member", user_id="u1")
    body = keys_mod.CreateAPIKeyRequest(
        name="ci", key_type=KEY_TYPE_USER, requests_per_minute=3, requests_per_day=40,
        daily_token_limit=500, monthly_token_limit=9000, monthly_spend_limit=12.5,
        expires_at="2030-06-01T00:00:00Z",
    )
    resp = await keys_mod.create_api_key("o1", body, key_info=caller)
    assert resp.monthly_spend_limit == 12.5
    assert store.keys[resp.id]["monthly_spend_limit"] == 12.5
    info = h.key_cache.get(hash_key(resp.key, h.hmac_secret))
    assert info is not None
    assert (info.requests_per_minute, info.requests_per_day) == (3, 40)
    assert (info.daily_token_limit, info.monthly_token_limit) == (500, 9000)
    assert info.monthly_spend_limit == 12.5
    assert info.expires_at == datetime(2030, 6, 1, tzinfo=timezone.utc)
    assert info.org_requests_per_minute == 30 and info.org_guardrail_pii is True


async def test_create_user_key_for_non_member_rejected(h: Handler, store: FakeKeyStore):
    store.users["u9"] = {"id": "u9", "is_system_admin": 0}
    caller = _info(role="org_admin", user_id="u1")
    body = keys_mod.CreateAPIKeyRequest(name="x", key_type=KEY_TYPE_USER, user_id="u9")
    with pytest.raises(HTTPException) as ei:
        await keys_mod.create_api_key("o1", body, key_info=caller)
    assert ei.value.status_code == 400
    assert not store.keys


async def test_patch_rotate_delete_update_cache(h: Handler, store: FakeKeyStore):
    # Limit changes are org_admin+ only (members may rename their own key).
    store.memberships[("u1", "o1")] = "org_admin"
    caller = _info(role="org_admin", user_id="u1")
    k = store.add(requests_per_minute=10)
    await h.seed_key_cache()
    await keys_mod.update_api_key(
        "o1", k["id"], keys_mod.UpdateAPIKeyRequest(requests_per_minute=1, monthly_spend_limit=2.0), key_info=caller
    )
    info = h.key_cache.get(k["key_hash"])
    assert info.requests_per_minute == 1 and info.monthly_spend_limit == 2.0

    old_hash = k["key_hash"]
    rotated = await keys_mod.rotate_api_key("o1", k["id"], key_info=caller)
    new_hash = hash_key(rotated.key, h.hmac_secret)
    assert h.key_cache.get(old_hash) is None
    assert h.key_cache.get(new_hash).requests_per_minute == 1

    await keys_mod.delete_api_key("o1", k["id"], key_info=caller)
    assert h.key_cache.get(new_hash) is None


async def test_patch_rejects_bad_expires_at(h: Handler, store: FakeKeyStore):
    k = store.add()
    with pytest.raises(HTTPException) as ei:
        await keys_mod.update_api_key(
            "o1", k["id"], keys_mod.UpdateAPIKeyRequest(expires_at="not-a-date"), key_info=_info()
        )
    assert ei.value.status_code == 400


async def test_patch_expiry_into_past_revokes_in_cache(h: Handler, store: FakeKeyStore):
    store.memberships[("u1", "o1")] = "org_admin"
    k = store.add()
    await h.seed_key_cache()
    await keys_mod.update_api_key(
        "o1", k["id"], keys_mod.UpdateAPIKeyRequest(expires_at="2000-01-01T00:00:00Z"),
        key_info=_info(role="org_admin"),
    )
    assert h.key_cache.get(k["key_hash"]) is None


async def test_logout_revokes_session(h: Handler, store: FakeKeyStore):
    token = generate_key(KEY_TYPE_SESSION)
    kh = hash_key(token, h.hmac_secret)
    s = store.add(key_type=KEY_TYPE_SESSION, key_hash=kh)
    await h.seed_key_cache()
    info = await authenticate_bearer(_req(token))
    resp = await auth_mod.logout(_req(token), key_info=info)
    assert resp.status_code == 204
    assert store.keys[s["id"]]["deleted"] is True
    with pytest.raises(HTTPException) as ei:
        await authenticate_bearer(_req(token))
    assert ei.value.status_code == 401


async def test_logout_rejects_non_session_keys(h: Handler, store: FakeKeyStore):
    k = store.add()
    await h.seed_key_cache()
    with pytest.raises(HTTPException) as ei:
        await auth_mod.logout(_req(), key_info=h.key_cache.get(k["key_hash"]))
    assert ei.value.status_code == 400
    assert store.keys[k["id"]]["deleted"] is False


async def test_cache_session_key_loads_org_limits(h: Handler, store: FakeKeyStore):
    s = store.add(key_type=KEY_TYPE_SESSION, expires_at="2030-01-01T00:00:00+00:00")
    info = await auth_mod._cache_session_key(h, s["id"], s["key_hash"])
    assert info.org_requests_per_minute == 30 and info.org_guardrail_tool_denylist == "shell"
    assert info.expires_at is not None


# --- limit errors ------------------------------------------------------------------------


def test_limit_reached_is_429_with_retry_after():
    exc = limit_reached("requests per minute limit exceeded")
    assert exc.status_code == 429
    assert exc.detail["error"]["code"] == "limit_reached"
    assert exc.detail["error"]["type"] == "rate_limit_error"
    assert exc.detail["error"]["message"] == "requests per minute limit exceeded"
    assert 1 <= int(exc.headers["Retry-After"]) <= 60
    assert limit_reached("x", retry_after=7).headers["Retry-After"] == "7"
    b = budget_exceeded("org monthly spend limit exceeded")
    assert b.status_code == 429 and int(b.headers["Retry-After"]) >= 1


def test_retry_after_windows():
    now = datetime(2026, 12, 31, 23, 59, 30, tzinfo=timezone.utc)
    assert _seconds_until_window_reset("requests per minute limit exceeded", now) == 30
    assert _seconds_until_window_reset("daily token limit exceeded", now) == 30
    assert _seconds_until_window_reset("requests per day limit exceeded", now) == 30
    assert _seconds_until_window_reset("monthly token limit exceeded", now) == 30
    mid = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
    assert _seconds_until_window_reset("daily token limit exceeded", mid) == 12 * 3600
