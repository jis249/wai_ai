"""Privilege-escalation guards: user PATCH, org memberships, team memberships, OIDC, setup status."""

from __future__ import annotations

from types import SimpleNamespace

import bcrypt
import pytest
from fastapi import HTTPException

from wai.api.admin import auth, org_memberships, setup, team_memberships, users
from wai.api.admin.common import KeyInfo
from wai.api.admin.handler import SSOConfig

PW = "correct-horse"
PW_HASH = bcrypt.hashpw(PW.encode(), bcrypt.gensalt(4)).decode()


def key(role: str, org: str = "A", user: str = "admin-a") -> KeyInfo:
    return KeyInfo(id="k", key_type="session_key", role=role, org_id=org, user_id=user)


# ---------------------------------------------------------------- fake DB state

USERS = {
    "sys": {"is_system_admin": True, "orgs": {"A": "org_admin"}},
    "admin-a": {"is_system_admin": False, "orgs": {"A": "org_admin"}},
    "admin-a2": {"is_system_admin": False, "orgs": {"A": "org_admin"}},
    "mem-a": {"is_system_admin": False, "orgs": {"A": "member"}},
    "mem-ab": {"is_system_admin": False, "orgs": {"A": "member", "B": "member"}},
    "mem-b": {"is_system_admin": False, "orgs": {"B": "member"}},
    "sso-a": {"is_system_admin": False, "orgs": {"A": "member"}, "no_pw": True},
}


class FakeHandler:
    def __init__(self) -> None:
        self.db = None
        self.updates: list[tuple[str, dict]] = []
        self.revoked: list[str] = []
        self.refreshed: list[dict] = []

    async def refresh_keys(self, **kw):
        self.refreshed.append(kw)

    async def revoke_user_sessions(self, user_id):
        self.revoked.append(user_id)


def _user_row(uid: str) -> dict:
    u = USERS[uid]
    return {
        "id": uid, "email": f"{uid}@x.com", "display_name": uid, "auth_provider": "local",
        "is_system_admin": u["is_system_admin"], "created_at": "t", "updated_at": "t",
    }


@pytest.fixture
def h(monkeypatch):
    fh = FakeHandler()
    repo = users.repo

    async def get_user(db, uid):
        return _user_row(uid) if uid in USERS else None

    async def list_user_org_roles(db, uid):
        return dict(USERS[uid]["orgs"]) if uid in USERS else {}

    async def get_user_org_role(db, uid, org_id):
        try:
            return USERS[uid]["orgs"][org_id]
        except KeyError:
            raise repo.NotFoundError("membership")

    async def get_user_password_hash_by_id(db, uid):
        return None if USERS.get(uid, {}).get("no_pw") else PW_HASH

    async def update_user(db, uid, fields):
        if uid not in USERS:
            raise repo.NotFoundError(uid)
        fh.updates.append((uid, fields))
        return _user_row(uid)

    for name, fn in {
        "get_user": get_user,
        "list_user_org_roles": list_user_org_roles,
        "get_user_org_role": get_user_org_role,
        "get_user_password_hash_by_id": get_user_password_hash_by_id,
        "update_user": update_user,
    }.items():
        monkeypatch.setattr(repo, name, fn)
    for mod in (users, org_memberships, team_memberships, auth, setup):
        monkeypatch.setattr(mod, "get_handler", lambda: fh)
    return fh


async def status_of(coro) -> int:
    try:
        await coro
        return 200
    except HTTPException as exc:
        return exc.status_code


# ---------------------------------------------------------------- 1. PATCH /users/{id}

@pytest.mark.parametrize(
    "caller,target,body,expected",
    [
        # org_admin can no longer take over the system admin / peers / multi-org users
        (key("org_admin"), "sys", {"password": "newpassword1"}, 403),
        (key("org_admin"), "sys", {"email": "evil@x.com"}, 403),
        (key("org_admin"), "sys", {"display_name": "x"}, 403),
        (key("org_admin"), "admin-a2", {"password": "newpassword1"}, 403),
        (key("org_admin"), "admin-a2", {"display_name": "x"}, 403),
        (key("org_admin"), "mem-ab", {"display_name": "x"}, 403),
        (key("org_admin"), "mem-a", {"password": "newpassword1"}, 403),
        (key("org_admin"), "mem-a", {"new_password": "newpassword1"}, 403),
        (key("org_admin"), "mem-a", {"email": "m@x.com"}, 403),
        (key("org_admin"), "mem-a", {"is_system_admin": True}, 403),
        (key("org_admin"), "mem-b", {"display_name": "x"}, 404),
        # still allowed: display name of a lower-ranked single-org member
        (key("org_admin"), "mem-a", {"display_name": "x"}, 200),
        # members cannot edit others
        (key("member", user="mem-a"), "mem-ab", {"display_name": "x"}, 403),
        # system admin can reset anyone
        (key("system_admin", user="sys"), "admin-a", {"password": "newpassword1"}, 200),
        (key("system_admin", user="sys"), "mem-b", {"email": "n@x.com"}, 200),
        (key("system_admin", user="sys"), "nobody", {"display_name": "x"}, 404),
    ],
)
async def test_update_user_authz(h, caller, target, body, expected):
    assert await status_of(users.update_user(target, users.UpdateUserRequest(**body), caller)) == expected
    if expected != 200:
        assert h.updates == []


async def test_self_password_change_requires_current_password(h):
    me = key("member", user="mem-a")
    body = users.UpdateUserRequest(new_password="newpassword1")
    assert await status_of(users.update_user("mem-a", body, me)) == 400
    body = users.UpdateUserRequest(current_password="wrong-password", new_password="newpassword1")
    assert await status_of(users.update_user("mem-a", body, me)) == 400
    assert h.updates == []
    body = users.UpdateUserRequest(current_password=PW, new_password="newpassword1")
    assert await status_of(users.update_user("mem-a", body, me)) == 200
    uid, fields = h.updates[-1]
    assert uid == "mem-a" and bcrypt.checkpw(b"newpassword1", fields["password_hash"].encode())
    assert h.revoked == []  # self-service change keeps the caller's own session


async def test_self_email_change_requires_current_password(h):
    me = key("org_admin", user="admin-a")
    assert await status_of(users.update_user("admin-a", users.UpdateUserRequest(email="z@x.com"), me)) == 400
    body = users.UpdateUserRequest(email="z@x.com", current_password=PW)
    assert await status_of(users.update_user("admin-a", body, me)) == 200


async def test_self_display_name_and_sso_account(h):
    me = key("member", user="mem-a")
    assert await status_of(users.update_user("mem-a", users.UpdateUserRequest(display_name="Me"), me)) == 200
    sso = key("member", user="sso-a")
    body = users.UpdateUserRequest(current_password="x", new_password="newpassword1")
    assert await status_of(users.update_user("sso-a", body, sso)) == 400


async def test_self_cannot_grant_system_admin(h):
    me = key("org_admin", user="admin-a")
    assert await status_of(users.update_user("admin-a", users.UpdateUserRequest(is_system_admin=True), me)) == 403


async def test_sysadmin_reset_revokes_target_sessions(h):
    sa = key("system_admin", user="sys")
    await users.update_user("mem-a", users.UpdateUserRequest(password="newpassword1"), sa)
    assert h.revoked == ["mem-a"]


# ---------------------------------------------------------------- 2. org memberships

MEMBERSHIPS = {
    "m-sys": {"id": "m-sys", "org_id": "A", "user_id": "sys", "role": "org_admin", "created_at": "t"},
    "m-admin": {"id": "m-admin", "org_id": "A", "user_id": "admin-a", "role": "org_admin", "created_at": "t"},
    "m-admin2": {"id": "m-admin2", "org_id": "A", "user_id": "admin-a2", "role": "org_admin", "created_at": "t"},
    "m-mem": {"id": "m-mem", "org_id": "A", "user_id": "mem-a", "role": "member", "created_at": "t"},
}


@pytest.fixture
def om(h, monkeypatch):
    state = {"admins": 3, "deleted": [], "updated": []}
    repo = org_memberships.repo

    async def get_org_membership(db, mid):
        m = MEMBERSHIPS.get(mid)
        return dict(m) if m else None

    async def count_org_admins(db, org_id):
        return state["admins"]

    async def update_org_membership(db, mid, role):
        state["updated"].append((mid, role))
        return {**MEMBERSHIPS[mid], "role": role or MEMBERSHIPS[mid]["role"]}

    async def delete_org_membership(db, mid):
        state["deleted"].append(mid)

    monkeypatch.setattr(repo, "get_org_membership", get_org_membership)
    monkeypatch.setattr(repo, "count_org_admins", count_org_admins)
    monkeypatch.setattr(repo, "update_org_membership", update_org_membership)
    monkeypatch.setattr(repo, "delete_org_membership", delete_org_membership)
    return state


@pytest.mark.parametrize(
    "caller,mid,expected",
    [
        (key("org_admin"), "m-sys", 403),
        (key("org_admin"), "m-admin2", 403),
        (key("org_admin"), "m-mem", 204),
        (key("org_admin"), "m-admin", 204),  # self-removal allowed
        (key("system_admin", user="sys"), "m-admin2", 204),
    ],
)
async def test_delete_org_membership_authz(om, caller, mid, expected):
    code = await status_of(org_memberships.delete_org_membership("A", mid, caller))
    assert (204 if code == 200 else code) == expected
    assert (mid in om["deleted"]) == (expected == 204)


@pytest.mark.parametrize(
    "caller,mid,expected",
    [
        (key("org_admin"), "m-sys", 403),
        (key("org_admin"), "m-admin2", 403),
        (key("org_admin"), "m-admin", 403),  # self-demotion goes through a system admin
        (key("org_admin"), "m-mem", 200),
        (key("system_admin", user="sys"), "m-admin2", 200),
    ],
)
async def test_update_org_membership_authz(om, caller, mid, expected):
    body = org_memberships.UpdateOrgMembershipRequest(role="member")
    assert await status_of(org_memberships.update_org_membership("A", mid, body, caller)) == expected


async def test_last_org_admin_cannot_be_removed_or_demoted(om):
    om["admins"] = 1
    sa = key("system_admin", user="sys")
    body = org_memberships.UpdateOrgMembershipRequest(role="member")
    assert await status_of(org_memberships.update_org_membership("A", "m-admin2", body, sa)) == 409
    assert await status_of(org_memberships.delete_org_membership("A", "m-admin2", sa)) == 409
    assert await status_of(org_memberships.delete_org_membership("A", "m-admin", key("org_admin"))) == 409
    # members are unaffected by the last-admin rule
    assert await status_of(org_memberships.delete_org_membership("A", "m-mem", sa)) == 200


# ---------------------------------------------------------------- 3. team memberships

async def test_team_membership_requires_org_membership(h, monkeypatch):
    added = []

    async def require_team_access(hh, ki, org_id, team_id):
        return {"id": team_id, "org_id": org_id}

    async def create_team_membership(db, team_id, user_id, role):
        added.append(user_id)
        return {"id": "tm", "team_id": team_id, "user_id": user_id, "role": role, "created_at": "t"}

    monkeypatch.setattr(team_memberships, "_require_team_access", require_team_access)
    monkeypatch.setattr(team_memberships.repo, "create_team_membership", create_team_membership)
    body = team_memberships.CreateTeamMembershipRequest(user_id="mem-b", role="member")
    assert await status_of(team_memberships.create_team_membership("A", "T1", body, key("org_admin"))) == 400
    body = team_memberships.CreateTeamMembershipRequest(user_id="mem-a", role="member")
    assert await status_of(team_memberships.create_team_membership("A", "T1", body, key("org_admin"))) == 200
    assert added == ["mem-a"]


# ---------------------------------------------------------------- 4. OIDC

def claims(email="a@corp.com", **extra):
    return SimpleNamespace(subject="sub-1", email=email, name="A", **extra)


@pytest.mark.parametrize(
    "domains,c,expected",
    [
        ([], claims(), ""),
        (["corp.com"], claims(), ""),
        (["CORP.com"], claims("a@Corp.COM"), ""),
        (["@corp.com"], claims(), ""),
        (["corp.com"], claims("a@evil.com"), "domain_not_allowed"),
        (["corp.com"], claims("a@sub.corp.com"), "domain_not_allowed"),
        (["corp.com"], claims(""), "domain_not_allowed"),
        ([], claims(email_verified=False), "email_not_verified"),
        ([], claims(email_verified="false"), "email_not_verified"),
        ([], claims(email_verified=True), ""),
        ([], claims(raw={"email_verified": False}), "email_not_verified"),
    ],
)
def test_oidc_identity_denial(domains, c, expected):
    assert auth._oidc_identity_denial(SSOConfig(allowed_domains=domains), c) == expected


class _Req:
    def __init__(self, state="s", nonce="n"):
        self.cookies = {"wai_oidc_state": f"{state}|{nonce}"}
        self.headers = {}


@pytest.fixture
def oidc(h, monkeypatch):
    created = {"users": [], "memberships": []}

    async def exchange(code, nonce):
        return h.next_claims

    h.sso_provider = SimpleNamespace(exchange=exchange)
    h.sso_config = SSOConfig(enabled=True, redirect_url="https://x/cb", auto_provision=True,
                             allowed_domains=["corp.com"], default_org_slug="acme")
    h.next_claims = claims()
    repo = auth.repo

    async def get_user_by_external_id(db, provider, sub):
        return None

    async def get_org_by_slug(db, slug):
        return {"id": "ORG-ACME", "slug": slug} if slug == "acme" else None

    async def create_user(db, **kw):
        created["users"].append(kw)
        return {"id": "new-user", "display_name": "A"}

    async def create_org_membership(db, org_id, user_id, role):
        created["memberships"].append((org_id, user_id, role))

    async def resolve_user_role(db, uid):
        raise repo.NotFoundError("stop-here")  # short-circuit before session creation

    async def list_orgs_with_counts(*a, **k):  # must no longer be used for provisioning
        raise AssertionError("orgs[0] fallback used")

    for name, fn in {
        "get_user_by_external_id": get_user_by_external_id,
        "get_org_by_slug": get_org_by_slug,
        "create_user": create_user,
        "create_org_membership": create_org_membership,
        "resolve_user_role": resolve_user_role,
        "list_orgs_with_counts": list_orgs_with_counts,
    }.items():
        monkeypatch.setattr(repo, name, fn)
    return created


async def test_oidc_rejects_disallowed_domain(h, oidc):
    h.next_claims = claims("a@evil.com")
    r = await auth.oidc_callback(_Req(), code="c", state="s")
    assert r.headers["location"] == "/login?error=domain_not_allowed"
    assert oidc["users"] == []


async def test_oidc_provisions_into_default_org_slug(h, oidc):
    h.sso_config.default_role = "system_admin"  # not a valid org role -> falls back to member
    await auth.oidc_callback(_Req(), code="c", state="s")
    assert oidc["memberships"] == [("ORG-ACME", "new-user", "member")]


async def test_oidc_refuses_provisioning_without_default_org(h, oidc):
    h.sso_config.default_org_slug = ""
    r = await auth.oidc_callback(_Req(), code="c", state="s")
    assert r.headers["location"] == "/login?error=provision_no_default_org"
    assert oidc["users"] == []
    h.sso_config.default_org_slug = "missing"
    r = await auth.oidc_callback(_Req(), code="c", state="s")
    assert r.headers["location"] == "/login?error=provision_no_default_org"


# ---------------------------------------------------------------- 5. setup status

class _SetupDB:
    def __init__(self, n_users: int):
        self.n = n_users

    async def fetchone(self, sql, *a):
        return {"n": self.n} if "COUNT" in sql else {"?column?": 1}


@pytest.fixture
def setup_env(h, monkeypatch):
    probes = []

    async def probe():
        probes.append(1)
        return {"ok": True, "base_url": "http://10.0.0.5:11434", "models": ["llama"], "loaded": []}

    monkeypatch.setattr(setup, "_probe_ollama", probe)
    state = {"key": None}

    async def optional_auth(request):
        return state["key"]

    monkeypatch.setattr(setup, "optional_auth", optional_auth)
    return SimpleNamespace(probes=probes, state=state)


async def test_setup_status_anonymous_is_minimal(h, setup_env):
    h.db = _SetupDB(3)
    out = await setup.setup_status(SimpleNamespace())
    assert out["ready"] is True and out["has_users"] is True and out["database"] == {"ok": True}
    assert out["version"] == "" and out["ollama"]["base_url"] == "" and out["ollama"]["models"] == []
    assert out["details_redacted"] is True
    assert setup_env.probes == []  # no outbound probe for anonymous callers


async def test_setup_status_non_admin_is_minimal(h, setup_env):
    h.db = _SetupDB(3)
    setup_env.state["key"] = key("org_admin")
    out = await setup.setup_status(SimpleNamespace())
    assert out["details_redacted"] is True and setup_env.probes == []


async def test_setup_status_system_admin_gets_details(h, setup_env):
    h.db = _SetupDB(3)
    setup_env.state["key"] = key("system_admin", user="sys")
    out = await setup.setup_status(SimpleNamespace())
    assert out["details_redacted"] is False and out["ollama"]["models"] == ["llama"] and out["version"]


async def test_setup_status_first_run_gets_details(h, setup_env):
    h.db = _SetupDB(0)
    out = await setup.setup_status(SimpleNamespace())
    assert out["details_redacted"] is False and out["ready"] is False
