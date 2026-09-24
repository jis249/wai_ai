"""Model deployment sub-resource handlers."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from wai.api.admin.common import (
    KeyInfo,
    ROLE_SYSTEM_ADMIN,
    bad_request,
    conflict,
    new_uuid,
    not_found,
)
from wai.api.admin.handler import get_handler, require_role
from wai.api.admin.models import _fetch_model, reload_live_models
from wai.crypto.aes import encrypt_string

router = APIRouter()

# Columns update_deployment may write. SET clauses are built only from this tuple.
_DEPLOYMENT_UPDATE_COLUMNS = (
    "name", "provider", "base_url", "azure_deployment", "azure_api_version", "gcp_project",
    "gcp_location", "weight", "priority", "api_key_encrypted",
)


class CreateDeploymentRequest(BaseModel):
    name: str
    provider: str
    base_url: str
    # Empty = no key of its own (the model's key is used only for the same host; see
    # wai.proxy.registry.load_db_into_registry).
    api_key: str = ""
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    weight: int = 1
    priority: int = 0


class UpdateDeploymentRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    base_url: str | None = None
    # None/absent or "" = keep the stored key; non-empty = replace it.
    api_key: str | None = None
    # Explicitly remove the stored key (mutually exclusive with a non-empty api_key).
    clear_api_key: bool = False
    azure_deployment: str | None = None
    azure_api_version: str | None = None
    gcp_project: str | None = None
    gcp_location: str | None = None
    weight: int | None = None
    priority: int | None = None


class DeploymentResponse(BaseModel):
    id: str
    model_id: str
    name: str
    provider: str
    base_url: str
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    weight: int
    priority: int
    is_active: bool
    has_api_key: bool = False
    created_at: str
    updated_at: str


def _dep_resp(row: dict[str, Any]) -> DeploymentResponse:
    return DeploymentResponse(
        id=row["id"],
        model_id=row["model_id"],
        name=row["name"],
        provider=row["provider"],
        base_url=row["base_url"],
        azure_deployment=row.get("azure_deployment") or "",
        azure_api_version=row.get("azure_api_version") or "",
        gcp_project=row.get("gcp_project") or "",
        gcp_location=row.get("gcp_location") or "",
        weight=int(row.get("weight") or 1),
        priority=int(row.get("priority") or 0),
        is_active=bool(row.get("is_active", 1)),
        has_api_key=bool(row.get("api_key_encrypted")),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def encrypt_deployment_api_key(h, deployment_id: str, api_key: str) -> str:
    """Encrypt a deployment key with the AAD load_db_into_registry decrypts with."""
    return encrypt_string(api_key, h.encryption_key, f"model_deployment:{deployment_id}".encode())


async def _get_deployment(h, model_id: str, deployment_id: str) -> dict[str, Any]:
    row = await h.db.fetchone(
        "SELECT * FROM model_deployments WHERE id = ? AND model_id = ? AND deleted_at IS NULL",
        (deployment_id, model_id),
    )
    if not row:
        raise not_found("deployment not found")
    return dict(row)


async def _ensure_name_free(h, model_id: str, name: str, deployment_id: str | None) -> None:
    # UNIQUE (model_id, name) also covers soft-deleted rows.
    row = await h.db.fetchone(
        "SELECT id FROM model_deployments WHERE model_id = ? AND name = ?", (model_id, name)
    )
    if row and row["id"] != deployment_id:
        raise conflict("a deployment with this name already exists for this model (possibly deleted)")


@router.post("/models/{model_id}/deployments", response_model=DeploymentResponse, status_code=status.HTTP_201_CREATED)
async def create_deployment(
    model_id: str,
    body: CreateDeploymentRequest,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> DeploymentResponse:
    h = get_handler()
    model = await _fetch_model(h, model_id)
    if not body.name or not body.provider or not body.base_url:
        raise bad_request("name, provider, and base_url are required")
    await _ensure_name_free(h, model_id, body.name, None)
    did = new_uuid()
    api_key = (body.api_key or "").strip()
    api_key_encrypted = encrypt_deployment_api_key(h, did, api_key) if api_key else None
    await h.db.execute(
        """INSERT INTO model_deployments (id, model_id, name, provider, base_url, api_key_encrypted,
                                            azure_deployment, azure_api_version, gcp_project, gcp_location,
                                            weight, priority, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
        (
            did, model_id, body.name, body.provider, body.base_url, api_key_encrypted,
            body.azure_deployment, body.azure_api_version, body.gcp_project, body.gcp_location,
            body.weight, body.priority,
        ),
    )
    await h.db.commit()
    row = await _get_deployment(h, model_id, did)
    await reload_live_models(h, f"create deployment {model['name']}/{body.name}")
    return _dep_resp(row)


@router.get("/models/{model_id}/deployments", response_model=list[DeploymentResponse])
async def list_deployments(
    model_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> list[DeploymentResponse]:
    h = get_handler()
    await _fetch_model(h, model_id)
    rows = await h.db.fetchall(
        "SELECT * FROM model_deployments WHERE model_id = ? AND deleted_at IS NULL ORDER BY priority, id",
        (model_id,),
    )
    return [_dep_resp(dict(r)) for r in rows]


@router.patch("/models/{model_id}/deployments/{deployment_id}", response_model=DeploymentResponse)
async def update_deployment(
    model_id: str,
    deployment_id: str,
    body: UpdateDeploymentRequest,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> DeploymentResponse:
    h = get_handler()
    await _get_deployment(h, model_id, deployment_id)
    data = body.model_dump(exclude_unset=True)
    api_key = (data.pop("api_key", None) or "").strip()
    clear_key = bool(data.pop("clear_api_key", False))
    if api_key and clear_key:
        raise bad_request("api_key and clear_api_key are mutually exclusive")
    for key in ("name", "provider", "base_url"):
        value = data.get(key)
        if value is not None and not str(value).strip():
            raise bad_request(f"{key} cannot be empty")
    if data.get("name") is not None:
        await _ensure_name_free(h, model_id, data["name"], deployment_id)
    fields: dict[str, Any] = {}
    for key in _DEPLOYMENT_UPDATE_COLUMNS:
        # None means "unchanged": every one of these columns is NOT NULL.
        if key != "api_key_encrypted" and data.get(key) is not None:
            fields[key] = data[key]
    if api_key:
        fields["api_key_encrypted"] = encrypt_deployment_api_key(h, deployment_id, api_key)
    elif clear_key:
        fields["api_key_encrypted"] = None
    if fields:
        cols = [c for c in _DEPLOYMENT_UPDATE_COLUMNS if c in fields]
        sets = ", ".join(f"{c} = ?" for c in cols)
        await h.db.execute(
            f"UPDATE model_deployments SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND model_id = ?",
            (*(fields[c] for c in cols), deployment_id, model_id),
        )
        await h.db.commit()
    row = await _get_deployment(h, model_id, deployment_id)
    if fields:
        await reload_live_models(h, f"update deployment {model_id}/{row['name']}")
    return _dep_resp(row)


@router.delete("/models/{model_id}/deployments/{deployment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deployment(
    model_id: str,
    deployment_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> Response:
    h = get_handler()
    cur = await h.db.execute(
        """UPDATE model_deployments SET deleted_at = CURRENT_TIMESTAMP
           WHERE id = ? AND model_id = ? AND deleted_at IS NULL""",
        (deployment_id, model_id),
    )
    await h.db.commit()
    if cur.rowcount == 0:
        raise not_found("deployment not found")
    await reload_live_models(h, f"delete deployment {model_id}/{deployment_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
