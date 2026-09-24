"""API-key authorization: privilege-escalation guards in wai.api.admin.keys (repo faked, no DB)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from wai.api.admin import handler as handler_mod
from wai.api.admin import keys as keys_mod
from wai.api.admin import repository as repo
from wai.api.admin.common import (
    KEY_TYPE_SA,
    KEY_TYPE_SESSION,
    KEY_TYPE_TEAM,
    KEY_TYPE_USER,
    KeyInfo,
)
from wai.api.admin.handler import Handler


class FakeRepo:
    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.org_roles: dict[tuple[str, str], str] = {}
        self.team_members: set[tuple[str, str]] = set()
        self.teams: dict[str, dict[str, Any]] = {
            "t1": {"id": "t1", "org_id": "o1"},
            "t2": {"id": "t2", "org_id": "o1"},
            "tx": {"id": "tx", "org_id": "o2"},
        }
        self.sas: dict[str, dict[str, Any]] = {
            "sa1": {"id": "sa1", "org_id": "o1", "team_id": None},
            "sa2": {"id": "sa2", "org_id": "o1", "team_id": "t1"},
        }
        self.keys: dict[str, dict[str, Any]] = {}
        self._n = 0
        for uid, role, sysadmin in (
            ("sys", None, True),
            ("oa1", "org_admin", False),
            ("oa2", "org_admin", False),
            ("ta", "team_admin", False),
            ("ta2", "team_admin", False),
            ("m1", "member", False),
            ("m2", "member", False),
            ("outsider", None, False),
        ):
            self.users[uid] = {"id": uid, "is_system_admin": sysadmin}
            if role:
                self.org_roles[(uid, "o1")] = role
        self.org_roles[("outsider", "o2")] = "member"
        self.team_members |= {("ta", "t1"), ("m1", "t1"), ("oa1", "t1"), ("ta2", "t2")}

    def add_key(self, **kw: Any) -> dict[str, Any]:
        self._n += 1
        row = {
            "id": f"00000000-0000-0000-0000-{self._n:012d}", "key_hash": f"h{self._n}", "key_hint": "wa_...", "key_type": KEY_TYPE_USER,
            "name": "n", "org_id": "o1", "team_id": None, "user_id": None, "service_account_id": None,
            "daily_token_limit": 0, "monthly_token_limit": 0, "requests_per_minute": 0, "requests_per_day": 0,
            "monthly_spend_limit": 0.0, "expires_at": None, "created_by": "x",
            "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00",
        }
        row.update(kw)
        self.keys[row["id"]] = row
        return row

    # repo API
    async def get_user(self, _db, uid):
        return self.users.get(uid)

    async def get_user_org_role(self, _db, uid, org_id):
        r = self.org_roles.get((uid, org_id))
        if r is None:
            raise repo.NotFoundError("membership")
        return r

    async def is_team_member(self, _db, uid, team_id):
        return (uid, team_id) in self.team_members

    async def get_team(self, _db, team_id):
        return self.teams.get(team_id)

    async def get_service_account(self, _db, sa_id):
        return self.sas.get(sa_id)

    async def create_api_key(self, _db, params):
        return self.add_key(**params)

    async def get_api_key(self, _db, key_id):
        k = self.keys.get(key_id)
        return dict(k) if k else None

    async def list_api_keys(self, _db, org_id, cursor, limit, include_deleted):
        rows = sorted((k for k in self.keys.values() if k["org_id"] == org_id), key=lambda k: k["id"])
        if cursor:
            rows = [k for k in rows if k["id"] > cursor]
        return [dict(k) for k in rows[:limit]]

    async def update_api_key(self, _db, key_id, fields):
        if key_id not in self.keys:
            raise repo.NotFoundError(key_id)
        self.keys[key_id].update(fields)
        return dict(self.keys[key_id])

    async def delete_api_key(self, _db, key_id):
        if key_id not in self.keys:
            raise repo.NotFoundError(key_id)
        del self.keys[key_id]


@pytest.fixture
def fr(monkeypatch: pytest.MonkeyPatch) -> FakeRepo:
    f = FakeRepo()
    for name in (
        "get_user", "get_user_org_role", "is_team_member", "get_team", "get_service_account",
        "create_api_key", "get_api_key", "list_api_keys", "update_api_key", "delete_api_key",
    ):
        monkeypatch.setattr(repo, name, getattr(f, name))
    handler = Handler(db=None, encryption_key=b"k" * 32)  # type: ignore[arg-type]

    async def _noop(**_kw: Any) -> int:
        return 0

    monkeypatch.setattr(handler, "refresh_keys", _noop)
    monkeypatch.setattr(handler_mod, "_handler", handler)
    return f


def user(uid: str, role: str, **kw: Any) -> KeyInfo:
    return KeyInfo(id=f"caller-{uid}", key_type=KEY_TYPE_USER, role=role, org_id="o1", user_id=uid, **kw)


ORG_ADMIN = lambda: user("oa1", "org_admin")  # noqa: E731
TEAM_ADMIN = lambda: user("ta", "team_admin")  # noqa: E731
MEMBER = lambda: user("m1", "member")  # noqa: E731
SYSADMIN = lambda: user("sys", "system_admin", is_system_admin=True)  # noqa: E731


def create_req(**kw: Any) -> keys_mod.CreateAPIKeyRequest:
    kw.setdefault("name", "k")
    kw.setdefault("key_type", KEY_TYPE_USER)
    return keys_mod.CreateAPIKeyRequest(**kw)


async def expect(status: int, coro) -> None:
    with pytest.raises(HTTPException) as ei:
        await coro
    assert ei.value.status_code == status, ei.value.detail


# --- 1. create: owner validation ---------------------------------------------------------


async def test_org_admin_cannot_create_key_for_system_admin(fr: FakeRepo):
    await expect(403, keys_mod.create_api_key("o1", create_req(user_id="sys"), key_info=ORG_ADMIN()))
    fr.org_roles[("sys", "o1")] = "member"  # even when the sysadmin is an org member
    await expect(403, keys_mod.create_api_key("o1", create_req(user_id="sys"), key_info=ORG_ADMIN()))
    assert not fr.keys


async def test_create_requires_target_membership(fr: FakeRepo):
    await expect(400, keys_mod.create_api_key("o1", create_req(user_id="outsider"), key_info=ORG_ADMIN()))
    assert not fr.keys


async def test_create_rejects_higher_ranked_target(fr: FakeRepo):
    # team_admin / member callers are pinned to themselves; an org_admin can target peers or below.
    ok = await keys_mod.create_api_key("o1", create_req(user_id="m2"), key_info=ORG_ADMIN())
    assert fr.keys[ok.id]["user_id"] == "m2"
    ok = await keys_mod.create_api_key("o1", create_req(user_id="oa2"), key_info=ORG_ADMIN())
    assert fr.keys[ok.id]["user_id"] == "oa2"
    # A member's body user_id is ignored (forced to self).
    ok = await keys_mod.create_api_key("o1", create_req(user_id="sys"), key_info=MEMBER())
    assert fr.keys[ok.id]["user_id"] == "m1"


async def test_system_admin_can_create_own_key_without_membership(fr: FakeRepo):
    ok = await keys_mod.create_api_key("o1", create_req(user_id="sys"), key_info=SYSADMIN())
    assert fr.keys[ok.id]["user_id"] == "sys"


async def test_machine_callers_cannot_create_keys(fr: FakeRepo):
    team_key = KeyInfo(id="tk", key_type=KEY_TYPE_TEAM, role="team_admin", org_id="o1", team_id="t1")
    sa_key = KeyInfo(id="sk", key_type=KEY_TYPE_SA, role="org_admin", org_id="o1", service_account_id="sa1")
    for caller in (team_key, sa_key):
        await expect(400, keys_mod.create_api_key("o1", create_req(user_id="m1"), key_info=caller))
    # Even a machine key that somehow carries a user_id is not treated as a user.
    odd = KeyInfo(id="tk2", key_type=KEY_TYPE_TEAM, role="team_admin", org_id="o1", team_id="t1", user_id="oa1")
    await expect(400, keys_mod.create_api_key("o1", create_req(user_id="m1"), key_info=odd))


# --- 4. create: team / service-account binding for user_key ----------------------------------


async def test_user_key_team_binding_validated(fr: FakeRepo):
    await expect(400, keys_mod.create_api_key("o1", create_req(team_id="tx"), key_info=MEMBER()))  # other org
    await expect(400, keys_mod.create_api_key("o1", create_req(team_id="t2"), key_info=MEMBER()))  # not a member
    await expect(400, keys_mod.create_api_key("o1", create_req(team_id="nope"), key_info=MEMBER()))
    await expect(400, keys_mod.create_api_key(
        "o1", create_req(user_id="m2", team_id="t1"), key_info=ORG_ADMIN()))  # target m2 not in t1
    ok = await keys_mod.create_api_key("o1", create_req(team_id="t1"), key_info=MEMBER())
    assert fr.keys[ok.id]["team_id"] == "t1"


async def test_user_key_rejects_service_account_id(fr: FakeRepo):
    await expect(400, keys_mod.create_api_key("o1", create_req(service_account_id="sa1"), key_info=MEMBER()))
    await expect(400, keys_mod.create_api_key(
        "o1", create_req(user_id="m1", service_account_id="sa1"), key_info=ORG_ADMIN()))
    assert not fr.keys


async def test_machine_keys_drop_user_binding(fr: FakeRepo):
    tk = await keys_mod.create_api_key(
        "o1", create_req(key_type=KEY_TYPE_TEAM, team_id="t1", user_id="sys", service_account_id="sa1"),
        key_info=ORG_ADMIN())
    assert fr.keys[tk.id]["user_id"] is None and fr.keys[tk.id]["service_account_id"] is None
    sk = await keys_mod.create_api_key(
        "o1", create_req(key_type=KEY_TYPE_SA, service_account_id="sa1", user_id="sys"), key_info=ORG_ADMIN())
    assert fr.keys[sk.id]["user_id"] is None
    await expect(400, keys_mod.create_api_key(
        "o1", create_req(key_type=KEY_TYPE_SA, service_account_id="sa2", team_id="t2"), key_info=ORG_ADMIN()))


# --- 2. manage/rotate: owner rank ----------------------------------------------------------


async def test_org_admin_cannot_touch_system_admin_key(fr: FakeRepo):
    k = fr.add_key(user_id="sys")
    await expect(404, keys_mod.get_api_key("o1", k["id"], key_info=ORG_ADMIN()))
    await expect(404, keys_mod.rotate_api_key("o1", k["id"], key_info=ORG_ADMIN()))
    await expect(404, keys_mod.update_api_key(
        "o1", k["id"], keys_mod.UpdateAPIKeyRequest(name="x"), key_info=ORG_ADMIN()))
    await expect(404, keys_mod.delete_api_key("o1", k["id"], key_info=ORG_ADMIN()))
    assert k["id"] in fr.keys and fr.keys[k["id"]]["key_hash"] == k["key_hash"]
    # system admin can.
    assert (await keys_mod.rotate_api_key("o1", k["id"], key_info=SYSADMIN())).key


async def test_org_admin_cannot_rotate_peer_org_admin_key(fr: FakeRepo):
    k = fr.add_key(user_id="oa2")
    await expect(404, keys_mod.rotate_api_key("o1", k["id"], key_info=ORG_ADMIN()))
    assert fr.keys[k["id"]]["key_hash"] == k["key_hash"]
    # Non-plaintext actions on a peer's key remain allowed.
    assert (await keys_mod.get_api_key("o1", k["id"], key_info=ORG_ADMIN())).id == k["id"]


async def test_org_admin_can_rotate_member_own_and_org_sa_keys(fr: FakeRepo):
    mk = fr.add_key(user_id="m1")
    own = fr.add_key(user_id="oa1")
    sa = fr.add_key(key_type=KEY_TYPE_SA, service_account_id="sa1")
    for k in (mk, own, sa):
        assert (await keys_mod.rotate_api_key("o1", k["id"], key_info=ORG_ADMIN())).key


async def test_member_manages_only_own_keys(fr: FakeRepo):
    own = fr.add_key(user_id="m1")
    other = fr.add_key(user_id="m2")
    assert (await keys_mod.rotate_api_key("o1", own["id"], key_info=MEMBER())).key
    await expect(404, keys_mod.get_api_key("o1", other["id"], key_info=MEMBER()))
    await expect(404, keys_mod.rotate_api_key("o1", other["id"], key_info=MEMBER()))


# --- 3. machine callers and team admins ---------------------------------------------------------


async def test_team_key_caller_has_no_management_power(fr: FakeRepo):
    me = fr.add_key(key_type=KEY_TYPE_TEAM, team_id="t1")
    member_key = fr.add_key(user_id="m1", team_id="t1")
    caller = KeyInfo(id=me["id"], key_type=KEY_TYPE_TEAM, role="team_admin", org_id="o1", team_id="t1")
    assert (await keys_mod.get_api_key("o1", me["id"], key_info=caller)).id == me["id"]
    for k in (me, member_key):
        await expect(404, keys_mod.rotate_api_key("o1", k["id"], key_info=caller))
        await expect(404, keys_mod.delete_api_key("o1", k["id"], key_info=caller))
        await expect(404, keys_mod.update_api_key(
            "o1", k["id"], keys_mod.UpdateAPIKeyRequest(name="x"), key_info=caller))
    await expect(404, keys_mod.get_api_key("o1", member_key["id"], key_info=caller))
    listed = await keys_mod.list_api_keys("o1", limit=20, cursor=None, key_info=caller)
    assert [k.id for k in listed.data] == [me["id"]]


async def test_org_level_sa_key_caller_has_no_management_power(fr: FakeRepo):
    me = fr.add_key(key_type=KEY_TYPE_SA, service_account_id="sa1")
    member_key = fr.add_key(user_id="m1")
    caller = KeyInfo(id=me["id"], key_type=KEY_TYPE_SA, role="org_admin", org_id="o1", service_account_id="sa1")
    await expect(404, keys_mod.get_api_key("o1", member_key["id"], key_info=caller))
    await expect(404, keys_mod.rotate_api_key("o1", member_key["id"], key_info=caller))
    listed = await keys_mod.list_api_keys("o1", limit=20, cursor=None, key_info=caller)
    assert [k.id for k in listed.data] == [me["id"]]


async def test_team_admin_scope_requires_real_team_membership(fr: FakeRepo):
    mk = fr.add_key(user_id="m1", team_id="t1")
    assert (await keys_mod.rotate_api_key("o1", mk["id"], key_info=TEAM_ADMIN())).key
    # ta2 is team_admin but not in t1; a forged team_id on the caller's key does not help.
    outsider = user("ta2", "team_admin", team_id="t1")
    await expect(404, keys_mod.get_api_key("o1", mk["id"], key_info=outsider))
    # Keys with no team are out of scope for team admins.
    unbound = fr.add_key(user_id="m2")
    await expect(404, keys_mod.get_api_key("o1", unbound["id"], key_info=TEAM_ADMIN()))


async def test_team_admin_cannot_touch_higher_or_peer_keys_in_team(fr: FakeRepo):
    oa_key = fr.add_key(user_id="oa1", team_id="t1")
    await expect(404, keys_mod.get_api_key("o1", oa_key["id"], key_info=TEAM_ADMIN()))
    await expect(404, keys_mod.rotate_api_key("o1", oa_key["id"], key_info=TEAM_ADMIN()))
    fr.team_members.add(("ta2", "t1"))
    peer = fr.add_key(user_id="ta2", team_id="t1")
    await expect(404, keys_mod.rotate_api_key("o1", peer["id"], key_info=TEAM_ADMIN()))
    assert (await keys_mod.get_api_key("o1", peer["id"], key_info=TEAM_ADMIN())).id == peer["id"]


# --- 5. PATCH limits ----------------------------------------------------------------------------


async def test_member_can_rename_but_not_change_limits(fr: FakeRepo):
    k = fr.add_key(user_id="m1", requests_per_minute=5, expires_at="2030-01-01T00:00:00+00:00")
    r = await keys_mod.update_api_key("o1", k["id"], keys_mod.UpdateAPIKeyRequest(name="new"), key_info=MEMBER())
    assert r.name == "new"
    for body in (
        {"requests_per_minute": 0},
        {"daily_token_limit": 10},
        {"monthly_token_limit": 10},
        {"requests_per_day": 10},
        {"monthly_spend_limit": 99.0},
        {"expires_at": "2099-01-01T00:00:00Z"},
        {"expires_at": None},
    ):
        await expect(403, keys_mod.update_api_key(
            "o1", k["id"], keys_mod.UpdateAPIKeyRequest(**body), key_info=MEMBER()))
    assert fr.keys[k["id"]]["requests_per_minute"] == 5
    assert fr.keys[k["id"]]["expires_at"] == "2030-01-01T00:00:00+00:00"
    # Re-sending unchanged values (as the edit form may) is fine.
    await keys_mod.update_api_key("o1", k["id"], keys_mod.UpdateAPIKeyRequest(
        name="n2", requests_per_minute=5, expires_at="2030-01-01T00:00:00Z"), key_info=MEMBER())


async def test_team_admin_cannot_change_limits_org_admin_can(fr: FakeRepo):
    k = fr.add_key(user_id="m1", team_id="t1")
    await expect(403, keys_mod.update_api_key(
        "o1", k["id"], keys_mod.UpdateAPIKeyRequest(requests_per_day=1), key_info=TEAM_ADMIN()))
    r = await keys_mod.update_api_key(
        "o1", k["id"], keys_mod.UpdateAPIKeyRequest(requests_per_day=1, monthly_spend_limit=3.0),
        key_info=ORG_ADMIN())
    assert r.requests_per_day == 1 and r.monthly_spend_limit == 3.0


# --- list -----------------------------------------------------------------------------------------


async def test_list_filters_by_authorization(fr: FakeRepo):
    sys_key = fr.add_key(user_id="sys")
    m1 = fr.add_key(user_id="m1")
    m2 = fr.add_key(user_id="m2")
    sess = fr.add_key(user_id="m2", key_type=KEY_TYPE_SESSION)
    ids = {k.id for k in (await keys_mod.list_api_keys("o1", limit=20, cursor=None, key_info=ORG_ADMIN())).data}
    assert ids == {m1["id"], m2["id"], sess["id"]}
    ids = {k.id for k in (await keys_mod.list_api_keys("o1", limit=20, cursor=None, key_info=MEMBER())).data}
    assert ids == {m1["id"]}
    ids = {k.id for k in (await keys_mod.list_api_keys("o1", limit=20, cursor=None, key_info=SYSADMIN())).data}
    assert sys_key["id"] in ids and len(ids) == 4


async def test_list_pagination_cursor_not_skipped_by_filtering(fr: FakeRepo):
    for _ in range(3):
        fr.add_key(user_id="m2")
    mine = fr.add_key(user_id="m1")
    page = await keys_mod.list_api_keys("o1", limit=2, cursor=None, key_info=MEMBER())
    assert page.data == [] and page.has_more and page.next_cursor.endswith("000000000002")
    page = await keys_mod.list_api_keys("o1", limit=2, cursor=page.next_cursor, key_info=MEMBER())
    assert [k.id for k in page.data] == [mine["id"]] and not page.has_more
