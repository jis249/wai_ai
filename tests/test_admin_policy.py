"""Admin API policy: SA keys are proxy-only; org limits are system-admin managed."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from wai.api.admin import orgs
from wai.api.admin.common import KeyInfo
from wai.api.admin.handler import require_role


async def _run(dep, key: KeyInfo) -> int:
    try:
        await dep(key_info=key)
        return 200
    except HTTPException as exc:
        return exc.status_code


async def test_sa_key_blocked_from_admin_api():
    dep = require_role("member")
    sa = KeyInfo(id="k", key_type="sa_key", role="org_admin", org_id="A")
    assert await _run(dep, sa) == 403


async def test_user_key_still_allowed():
    dep = require_role("org_admin")
    user = KeyInfo(id="k", key_type="user_key", role="org_admin", org_id="A", user_id="u")
    assert await _run(dep, user) == 200


@pytest.mark.parametrize(
    "field,current,new,same",
    [
        ("daily_token_limit", 1000, 1000, True),
        ("daily_token_limit", 1000, 0, False),
        ("monthly_spend_limit", None, 0.0, True),
        ("guardrail_pii", 1, True, True),
        ("guardrail_pii", 1, False, False),
        ("guardrail_tool_denylist", None, "", True),
        ("guardrail_tool_denylist", "exec", "", False),
    ],
)
def test_same_org_value(field, current, new, same):
    assert orgs._same_org_value(field, current, new) is same
