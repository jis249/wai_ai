"""Members can read their own organization (read-only Organization > Settings), nothing else."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from wai.api.admin import orgs
from wai.api.admin.common import KeyInfo


def _org(org_id: str) -> dict:
    return {
        "id": org_id, "name": "WAI", "slug": "wai", "timezone": None, "daily_token_limit": 0,
        "monthly_token_limit": 0, "requests_per_minute": 0, "requests_per_day": 0, "member_count": 1,
        "team_count": 0, "created_at": "", "updated_at": "", "deleted_at": None,
    }


@pytest.fixture(autouse=True)
def fake_repo(monkeypatch):
    async def get_org_with_counts(db, org_id):
        return _org(org_id)

    monkeypatch.setattr(orgs, "get_handler", lambda: SimpleNamespace(db=None))
    monkeypatch.setattr(orgs.repo, "get_org_with_counts", get_org_with_counts)


def _key(role: str, org: str) -> KeyInfo:
    return KeyInfo(id="k", key_type="session_key", role=role, org_id=org, user_id="u")


async def test_member_reads_own_org():
    resp = await orgs.get_org("o1", key_info=_key("member", "o1"))
    assert resp.id == "o1"


async def test_member_cannot_read_other_org():
    with pytest.raises(HTTPException) as e:
        await orgs.get_org("o2", key_info=_key("member", "o1"))
    assert e.value.status_code == 403
