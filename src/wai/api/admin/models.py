"""Model CRUD and health handlers."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field

from wai.api.admin.common import (
    KeyInfo,
    ROLE_MEMBER,
    ROLE_SYSTEM_ADMIN,
    bad_request,
    conflict,
    has_role,
    internal_error,
    new_uuid,
    not_found,
    parse_pagination,
)
from wai.api.admin.handler import get_handler, require_role
from wai.api.admin import repository as repo
from wai.crypto.aes import encrypt_string

router = APIRouter()
logger = logging.getLogger("wai.admin.models")

VALID_PROVIDERS = {"vllm", "openai", "anthropic", "azure", "custom", "vertex"}
VALID_TYPES = {
    "chat", "embedding", "reranking", "completion", "image", "audio_transcription", "tts"
}


class CreateModelRequest(BaseModel):
    name: str
    provider: str
    type: str = "chat"
    base_url: str
    api_key: str = ""
    max_context_tokens: int = 0
    input_price_per_1m: float = 0
    output_price_per_1m: float = 0
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    aliases: list[str] = Field(default_factory=list)
    timeout: str = ""
    strategy: str = ""
    max_retries: int = 0
    fallback_model_name: str = ""


class UpdateModelRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    type: str | None = None
    base_url: str | None = None
    # None/absent or "" = keep the stored key; non-empty = replace it.
    api_key: str | None = None
    # Explicitly remove the stored key (mutually exclusive with a non-empty api_key).
    clear_api_key: bool = False
    max_context_tokens: int | None = None
    input_price_per_1m: float | None = None
    output_price_per_1m: float | None = None
    azure_deployment: str | None = None
    azure_api_version: str | None = None
    gcp_project: str | None = None
    gcp_location: str | None = None
    aliases: list[str] | None = None
    timeout: str | None = None
    strategy: str | None = None
    max_retries: int | None = None
    fallback_model_name: str | None = None


class ModelResponse(BaseModel):
    id: str
    name: str
    provider: str
    type: str
    base_url: str
    max_context_tokens: int
    input_price_per_1m: float
    output_price_per_1m: float
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    is_active: bool
    source: str
    aliases: list[str] = Field(default_factory=list)
    timeout: str = ""
    strategy: str = ""
    max_retries: int = 0
    fallback_model_name: str = ""
    has_api_key: bool = False
    created_at: str
    updated_at: str


class PaginatedModelsResponse(BaseModel):
    data: list[ModelResponse]
    has_more: bool
    next_cursor: str | None = None


class AccessibleModelResponse(BaseModel):
    id: str
    name: str
    provider: str
    type: str
    max_context_tokens: int
    input_price_per_1m: float = 0
    output_price_per_1m: float = 0
    is_active: bool
    aliases: list[str] = Field(default_factory=list)
    strategy: str = ""
    fallback_model_name: str = ""


class AccessibleModelsListResponse(BaseModel):
    data: list[AccessibleModelResponse]


class TestConnectionRequest(BaseModel):
    provider: str
    base_url: str
    api_key: str = ""
    azure_deployment: str = ""
    azure_api_version: str = ""


class TestConnectionResponse(BaseModel):
    status: str
    message: str = ""


class ModelHealthResponse(BaseModel):
    models: list[dict[str, Any]]


def _model_resp(row: dict[str, Any]) -> ModelResponse:
    aliases = row.get("aliases", "") or ""
    alias_list = [a.strip() for a in aliases.split(",") if a.strip()] if aliases else []
    return ModelResponse(
        id=row["id"],
        name=row["name"],
        provider=row["provider"],
        type=row.get("model_type") or row.get("type") or "chat",
        base_url=row["base_url"],
        max_context_tokens=int(row.get("max_context_tokens") or 0),
        input_price_per_1m=float(row.get("input_price_per_1m") or 0),
        output_price_per_1m=float(row.get("output_price_per_1m") or 0),
        azure_deployment=row.get("azure_deployment") or "",
        azure_api_version=row.get("azure_api_version") or "",
        gcp_project=row.get("gcp_project") or "",
        gcp_location=row.get("gcp_location") or "",
        is_active=bool(row.get("is_active", 1)),
        source=row.get("source") or "api",
        aliases=alias_list,
        timeout=row.get("timeout") or "",
        strategy=row.get("strategy") or "",
        max_retries=int(row.get("max_retries") or 0),
        fallback_model_name=row.get("fallback_model_name") or "",
        has_api_key=bool(row.get("api_key_encrypted")),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _accessible_model_resp(row: dict[str, Any]) -> AccessibleModelResponse:
    aliases = row.get("aliases", "") or ""
    alias_list = [a.strip() for a in aliases.split(",") if a.strip()] if aliases else []
    return AccessibleModelResponse(
        id=row["id"],
        name=row["name"],
        provider=row["provider"],
        type=row.get("model_type") or row.get("type") or "chat",
        max_context_tokens=int(row.get("max_context_tokens") or 0),
        input_price_per_1m=float(row.get("input_price_per_1m") or 0),
        output_price_per_1m=float(row.get("output_price_per_1m") or 0),
        is_active=bool(row.get("is_active", 1)),
        aliases=alias_list,
        strategy=row.get("strategy") or "",
        fallback_model_name=row.get("fallback_model_name") or "",
    )


# models has no fallback_model_name column: the fallback is stored as fallback_model_id
# (migration 0011) and its name is resolved with a self-join.
_MODEL_SELECT = """SELECT m.*, f.name AS fallback_model_name
                   FROM models m
                   LEFT JOIN models f ON f.id = m.fallback_model_id AND f.deleted_at IS NULL"""

# Columns update_model may write (never built from request keys directly).
_MODEL_UPDATE_COLUMNS = (
    "name", "provider", "model_type", "base_url", "max_context_tokens", "input_price_per_1m",
    "output_price_per_1m", "azure_deployment", "azure_api_version", "gcp_project",
    "gcp_location", "aliases", "timeout", "strategy", "max_retries", "fallback_model_id",
    "api_key_encrypted",
)


async def _fetch_model(h, model_id: str) -> dict[str, Any]:
    row = await h.db.fetchone(
        f"{_MODEL_SELECT} WHERE m.id = ? AND m.deleted_at IS NULL", (model_id,)
    )
    if not row:
        raise not_found("model not found")
    return dict(row)


def encrypt_model_api_key(h, model_id: str, api_key: str) -> str:
    """Encrypt a model upstream key with the AAD load_db_into_registry decrypts with."""
    return encrypt_string(api_key, h.encryption_key, f"model:{model_id}".encode())


async def _resolve_fallback_id(h, name: str, model_id: str | None) -> str | None:
    name = (name or "").strip()
    if not name:
        return None
    row = await h.db.fetchone(
        "SELECT id FROM models WHERE name = ? AND deleted_at IS NULL", (name,)
    )
    if not row:
        raise bad_request("fallback model not found")
    if model_id is not None and row["id"] == model_id:
        raise bad_request("a model cannot fall back to itself")
    return row["id"]


async def _ensure_name_free(h, name: str, model_id: str | None) -> None:
    # models.name is UNIQUE across all rows, including soft-deleted ones.
    row = await h.db.fetchone("SELECT id FROM models WHERE name = ?", (name,))
    if row and row["id"] != model_id:
        raise conflict("a model with this name already exists (possibly deleted)")


async def reload_live_models(h, action: str) -> None:
    """Make a dashboard model/deployment change visible to the live proxy.

    Calls the app's ``reload_models`` hook (proxy registry + admin registry + health probe).
    Never raises: the admin change is already committed, so a reload failure is logged and
    the change applies on the next successful reload or restart.
    """
    hook = getattr(h, "reload_models", None)
    if hook is not None:
        try:
            await hook()
            return
        except Exception:
            logger.exception(
                "live proxy model reload failed after %s; the change is saved but not yet live", action
            )
    try:
        await reload_admin_model_registry(h)
    except Exception:
        logger.exception("admin model registry reload failed after %s", action)


def _with_circuits(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach per-deployment circuit breaker state (``deployments``) to health items."""
    from wai.proxy.circuit import get_active_registry

    circuits = get_active_registry()
    if circuits is None:
        return [dict(item) for item in items]
    try:
        snapshot = circuits.snapshot()
    except Exception:
        return [dict(item) for item in items]
    by_model: dict[str, list[dict[str, Any]]] = {}
    for dep in snapshot:
        model_name = dep.pop("model", "")
        by_model.setdefault(model_name, []).append(dep)
    out: list[dict[str, Any]] = []
    for item in items:
        enriched = dict(item)
        enriched["deployments"] = by_model.get(item.get("name") or "", [])
        out.append(enriched)
    return out


@router.get("/models/health", response_model=ModelHealthResponse)
async def get_model_health(key_info: KeyInfo = Depends(require_role(ROLE_MEMBER))) -> ModelHealthResponse:
    h = get_handler()
    if h.health_checker is None:
        return ModelHealthResponse(models=[])
    items = _with_circuits(h.health_checker.get_all_health())
    if has_role(key_info.role, ROLE_SYSTEM_ADMIN):
        return ModelHealthResponse(models=items)
    # Non-system-admins only see models their org is granted (org-level allowlist, same
    # cache as /me/models), and never the raw upstream error text.
    visible: list[dict[str, Any]] = []
    for item in items:
        name = item.get("name") or ""
        if not name or not h.access_cache.check(key_info.org_id, "", "", name):
            continue
        redacted = dict(item)
        if redacted.get("last_error"):
            redacted["last_error"] = ""
        visible.append(redacted)
    return ModelHealthResponse(models=visible)


@router.get("/me/models", response_model=AccessibleModelsListResponse)
async def list_accessible_models(
    key_info: KeyInfo = Depends(require_role(ROLE_MEMBER)),
) -> AccessibleModelsListResponse:
    """Read-only list of active models the current key may use."""
    h = get_handler()
    rows = await h.db.fetchall(
        f"{_MODEL_SELECT} WHERE m.deleted_at IS NULL AND m.is_active = 1 ORDER BY m.name"
    )
    models: list[AccessibleModelResponse] = []
    for row in rows:
        name = row["name"]
        if h.access_cache.check(key_info.org_id, key_info.team_id, key_info.id, name):
            models.append(_accessible_model_resp(dict(row)))
    return AccessibleModelsListResponse(data=models)


@router.post("/models/test-connection", response_model=TestConnectionResponse)
async def test_model_connection(
    body: TestConnectionRequest,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> TestConnectionResponse:
    if body.provider not in VALID_PROVIDERS:
        raise bad_request("invalid provider")
    url = body.base_url.rstrip("/") + "/models"
    headers = {}
    if body.api_key:
        headers["Authorization"] = f"Bearer {body.api_key}"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code < 500:
            return TestConnectionResponse(status="ok")
        return TestConnectionResponse(status="error", message=f"upstream returned {resp.status_code}")
    except Exception as e:
        return TestConnectionResponse(status="error", message=str(e))


@router.post("/models", response_model=ModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: CreateModelRequest,
    key_info: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> ModelResponse:
    h = get_handler()
    if not body.name or not body.provider or not body.base_url:
        raise bad_request("name, provider, and base_url are required")
    if body.type not in VALID_TYPES:
        raise bad_request("invalid model type")
    await _ensure_name_free(h, body.name, None)
    fallback_id = await _resolve_fallback_id(h, body.fallback_model_name, None)
    mid = new_uuid()
    api_key = (body.api_key or "").strip()
    api_key_encrypted = encrypt_model_api_key(h, mid, api_key) if api_key else None
    aliases = ",".join(body.aliases)
    await h.db.execute(
        """INSERT INTO models (id, name, provider, model_type, base_url, api_key_encrypted,
                                max_context_tokens, input_price_per_1m, output_price_per_1m,
                                azure_deployment, azure_api_version, gcp_project, gcp_location,
                                aliases, timeout, strategy, max_retries, fallback_model_id,
                                is_active, source, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'api', ?,
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
        (
            mid, body.name, body.provider, body.type, body.base_url, api_key_encrypted,
            body.max_context_tokens, body.input_price_per_1m, body.output_price_per_1m,
            body.azure_deployment, body.azure_api_version, body.gcp_project, body.gcp_location,
            aliases, body.timeout, body.strategy, body.max_retries, fallback_id,
            key_info.user_id or None,
        ),
    )
    await h.db.commit()
    row = await _fetch_model(h, mid)
    await reload_live_models(h, f"create model {body.name}")
    return _model_resp(row)


@router.get("/models", response_model=PaginatedModelsResponse)
async def list_models(
    limit: int | None = Query(20),
    cursor: str | None = Query(None),
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> PaginatedModelsResponse:
    h = get_handler()
    p = parse_pagination(limit, cursor)
    params: list[Any] = []
    cursor_clause = ""
    if p.cursor:
        cursor_clause = "AND m.id > ?"
        params.append(p.cursor)
    params.append(p.limit + 1)
    rows = await h.db.fetchall(
        f"""{_MODEL_SELECT} WHERE m.deleted_at IS NULL {cursor_clause}
            ORDER BY m.id LIMIT ?""",
        tuple(params),
    )
    models = [dict(r) for r in rows]
    has_more = len(models) > p.limit
    if has_more:
        models = models[: p.limit]
    return PaginatedModelsResponse(
        data=[_model_resp(m) for m in models],
        has_more=has_more,
        next_cursor=models[-1]["id"] if has_more and models else None,
    )


@router.get("/models/{model_id}", response_model=ModelResponse)
async def get_model(
    model_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> ModelResponse:
    h = get_handler()
    row = await _fetch_model(h, model_id)
    return _model_resp(row)


@router.patch("/models/{model_id}", response_model=ModelResponse)
async def update_model(
    model_id: str,
    body: UpdateModelRequest,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> ModelResponse:
    h = get_handler()
    await _fetch_model(h, model_id)
    data = body.model_dump(exclude_unset=True)
    api_key = (data.pop("api_key", None) or "").strip()
    clear_key = bool(data.pop("clear_api_key", False))
    if api_key and clear_key:
        raise bad_request("api_key and clear_api_key are mutually exclusive")
    fields: dict[str, Any] = {}
    for key in ("name", "provider", "base_url"):
        value = data.get(key)
        if value is not None and not str(value).strip():
            raise bad_request(f"{key} cannot be empty")
    if data.get("type") is not None:
        if data["type"] not in VALID_TYPES:
            raise bad_request("invalid model type")
        fields["model_type"] = data["type"]
    if data.get("aliases") is not None:
        fields["aliases"] = ",".join(data["aliases"])
    if data.get("name") is not None:
        await _ensure_name_free(h, data["name"], model_id)
    for key in (
        "name", "provider", "base_url", "max_context_tokens", "input_price_per_1m",
        "output_price_per_1m", "azure_deployment", "azure_api_version", "gcp_project",
        "gcp_location", "timeout", "strategy", "max_retries",
    ):
        # None means "unchanged" (these columns are NOT NULL or have no null meaning).
        if data.get(key) is not None:
            fields[key] = data[key]
    if "fallback_model_name" in data:
        # "" or null clears the fallback.
        fields["fallback_model_id"] = await _resolve_fallback_id(
            h, data["fallback_model_name"] or "", model_id
        )
    if api_key:
        fields["api_key_encrypted"] = encrypt_model_api_key(h, model_id, api_key)
    elif clear_key:
        fields["api_key_encrypted"] = None
    if fields:
        cols = [c for c in _MODEL_UPDATE_COLUMNS if c in fields]
        sets = ", ".join(f"{c} = ?" for c in cols)
        await h.db.execute(
            f"UPDATE models SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (*(fields[c] for c in cols), model_id),
        )
        await h.db.commit()
    row = await _fetch_model(h, model_id)
    if fields:
        await reload_live_models(h, f"update model {row['name']}")
    return _model_resp(row)


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> Response:
    h = get_handler()
    cur = await h.db.execute(
        "UPDATE models SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        (model_id,),
    )
    await h.db.commit()
    if cur.rowcount == 0:
        raise not_found("model not found")
    await reload_live_models(h, f"delete model {model_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/models/{model_id}/activate", response_model=ModelResponse)
async def activate_model(
    model_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> ModelResponse:
    return await _set_model_active(model_id, True)


@router.patch("/models/{model_id}/deactivate", response_model=ModelResponse)
async def deactivate_model(
    model_id: str,
    _: KeyInfo = Depends(require_role(ROLE_SYSTEM_ADMIN)),
) -> ModelResponse:
    return await _set_model_active(model_id, False)


async def _set_model_active(model_id: str, active: bool) -> ModelResponse:
    h = get_handler()
    await _fetch_model(h, model_id)
    await h.db.execute(
        "UPDATE models SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        (1 if active else 0, model_id),
    )
    await h.db.commit()
    row = await _fetch_model(h, model_id)
    await reload_live_models(h, f"{'activate' if active else 'deactivate'} model {row['name']}")
    return _model_resp(row)


async def reload_admin_model_registry(h) -> None:
    rows = await h.db.fetchall(
        "SELECT name, model_type AS type FROM models WHERE deleted_at IS NULL AND is_active = 1"
    )
    h.registry.reload([dict(r) for r in rows])
