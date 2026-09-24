"""Onboarding checklist status for the caller's org."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from wai.api.admin.common import KeyInfo
from wai.api.admin.handler import auth_middleware, get_handler
from wai.api.admin import repository as repo

router = APIRouter()


class OnboardingStatusResponse(BaseModel):
    has_models: bool = False
    has_keys: bool = False
    has_requests: bool = False
    has_budget: bool = False
    has_members: bool = False


@router.get("/onboarding/status", response_model=OnboardingStatusResponse)
async def onboarding_status(key_info: KeyInfo = Depends(auth_middleware)) -> OnboardingStatusResponse:
    """Setup progress for the caller's org (system admins: their own org). Any role may call."""
    h = get_handler()
    status = await repo.get_onboarding_status(h.db, key_info.org_id or "")
    return OnboardingStatusResponse(**status)
