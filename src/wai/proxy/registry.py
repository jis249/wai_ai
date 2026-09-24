"""Model registry built from YAML config with DB overlay."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Iterable
from urllib.parse import urlsplit

from wai.config.loader import parse_duration
from wai.config.models import ModelConfig, PricingConfig
from wai.crypto.aes import decrypt_string, encrypt_string
from wai.db.connection import Database

ERR_MODEL_NOT_FOUND = "model not found"


@dataclass
class Deployment:
    name: str = ""
    provider: str = ""
    base_url: str = ""
    api_key: str = ""
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    weight: int = 0
    priority: int = 0


@dataclass
class Model:
    name: str = ""
    provider: str = ""
    type: str = "chat"
    base_url: str = ""
    api_key: str = ""
    aliases: list[str] = field(default_factory=list)
    max_context_tokens: int = 0
    pricing: PricingConfig = field(default_factory=PricingConfig)
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    timeout: timedelta = field(default_factory=lambda: timedelta(0))
    strategy: str = ""
    max_retries: int = 0
    fallback_model_name: str = ""
    deployments: list[Deployment] = field(default_factory=list)
    source: str = "yaml"


@dataclass
class ModelInfo:
    name: str
    provider: str
    type: str
    aliases: list[str]
    max_context_tokens: int = 0
    strategy: str = ""
    deployment_count: int = 0


def _model_from_config(mc: ModelConfig) -> Model:
    timeout = parse_duration(mc.timeout) or timedelta(0)
    model_type = mc.type or "chat"
    deployments = [
        Deployment(
            name=d.name,
            provider=d.provider,
            base_url=d.base_url,
            api_key=d.api_key,
            azure_deployment=d.azure_deployment,
            azure_api_version=d.azure_api_version,
            gcp_project=d.gcp_project,
            gcp_location=d.gcp_location,
            weight=d.weight,
            priority=d.priority,
        )
        for d in mc.deployments
    ]
    return Model(
        name=mc.name,
        provider=mc.provider,
        type=model_type,
        base_url=mc.base_url,
        api_key=mc.api_key,
        aliases=list(mc.aliases),
        max_context_tokens=mc.max_context_tokens,
        pricing=mc.pricing,
        azure_deployment=mc.azure_deployment,
        azure_api_version=mc.azure_api_version,
        gcp_project=mc.gcp_project,
        gcp_location=mc.gcp_location,
        timeout=timeout,
        strategy=mc.strategy,
        max_retries=mc.max_retries,
        fallback_model_name=mc.fallback,
        deployments=deployments,
        source="yaml",
    )


class Registry:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._models: dict[str, Model] = {}
        self._aliases: dict[str, str] = {}
        self._sorted: list[Model] = []
        # Models defined in YAML config (with their YAML deployments). Used by
        # replace_db_models to keep YAML-only models and YAML deployments across DB reloads.
        self._yaml: dict[str, Model] = {}

    @classmethod
    def from_yaml(cls, models: list[ModelConfig]) -> Registry:
        reg = cls()
        for mc in models:
            model = _model_from_config(mc)
            reg.add_model(model)
            reg._yaml[model.name] = cls._copy(model)
        return reg

    def yaml_model(self, name: str) -> Model | None:
        """Return a copy of the YAML-configured model ``name`` (None if not in YAML)."""
        with self._lock:
            m = self._yaml.get(name)
            return self._copy(m) if m is not None else None

    def replace_db_models(
        self,
        db_models: list[Model],
        db_names: Iterable[str],
        log: logging.Logger | None = None,
    ) -> None:
        """Atomically rebuild the registry from the database state.

        ``db_models`` are the active DB models (they take precedence). ``db_names`` is every
        model name that has a DB row in any state (active, inactive or soft-deleted): a YAML
        model whose name appears there is governed by the DB, so it disappears when the DB row
        is deactivated or deleted. YAML models with no DB row at all are kept. A DB model
        that cannot be added (alias collision) keeps its previously registered version, if any.
        """
        logger = log or logging.getLogger("wai.registry")
        known = set(db_names)
        models: dict[str, Model] = {}
        aliases: dict[str, str] = {}

        def try_add(model: Model) -> str:
            if model.name in models:
                return f"duplicate model name {model.name!r}"
            if model.name in aliases:
                return f"model name {model.name!r} collides with an alias"
            for alias in model.aliases:
                if alias in aliases and aliases[alias] != model.name:
                    return f"duplicate alias {alias!r}"
                if alias in models and alias != model.name:
                    return f"alias {alias!r} collides with model name"
            for alias in model.aliases:
                aliases[alias] = model.name
            models[model.name] = model
            return ""

        with self._lock:
            previous = dict(self._models)
            yaml_models = dict(self._yaml)
        for model in db_models:
            err = try_add(model)
            if err:
                logger.warning("skipping model %s: %s", model.name, err)
                old = previous.get(model.name)
                if old is not None and try_add(old) == "":
                    logger.warning("keeping previous definition of model %s", model.name)
        for name, model in yaml_models.items():
            if name in known or name in models:
                continue
            err = try_add(self._copy(model))
            if err:
                logger.warning("skipping yaml model %s: %s", name, err)
        with self._lock:
            self._models = models
            self._aliases = aliases
            self._rebuild_sorted()

    def add_model(self, model: Model) -> None:
        with self._lock:
            if model.name in self._models:
                old = self._models[model.name]
                for alias in old.aliases:
                    self._aliases.pop(alias, None)
            for alias in model.aliases:
                if alias in self._aliases and self._aliases[alias] != model.name:
                    raise ValueError(f"duplicate alias {alias!r}")
                if alias in self._models and alias != model.name:
                    raise ValueError(f"alias {alias!r} collides with model name")
                self._aliases[alias] = model.name
            self._models[model.name] = model
            self._rebuild_sorted()

    def resolve(self, name_or_alias: str) -> Model:
        with self._lock:
            if name_or_alias in self._models:
                return self._copy(self._models[name_or_alias])
            if name_or_alias in self._aliases:
                return self._copy(self._models[self._aliases[name_or_alias]])
            raise KeyError(ERR_MODEL_NOT_FOUND)

    def list_info(self) -> list[ModelInfo]:
        with self._lock:
            return [
                ModelInfo(
                    name=m.name,
                    provider=m.provider,
                    type=m.type,
                    aliases=list(m.aliases),
                    max_context_tokens=m.max_context_tokens,
                    strategy=m.strategy,
                    deployment_count=len(m.deployments),
                )
                for m in self._sorted
            ]

    def _rebuild_sorted(self) -> None:
        self._sorted = sorted(self._models.values(), key=lambda m: m.name)

    @staticmethod
    def _copy(m: Model) -> Model:
        return Model(
            name=m.name,
            provider=m.provider,
            type=m.type,
            base_url=m.base_url,
            api_key=m.api_key,
            aliases=list(m.aliases),
            max_context_tokens=m.max_context_tokens,
            pricing=m.pricing,
            azure_deployment=m.azure_deployment,
            azure_api_version=m.azure_api_version,
            gcp_project=m.gcp_project,
            gcp_location=m.gcp_location,
            timeout=m.timeout,
            strategy=m.strategy,
            max_retries=m.max_retries,
            fallback_model_name=m.fallback_model_name,
            deployments=list(m.deployments),
            source=m.source,
        )


async def sync_yaml_models(
    db: Database,
    models: list[ModelConfig],
    enc_key: bytes,
    log: logging.Logger | None = None,
) -> None:
    """Upsert YAML-configured models into the database."""
    from wai.api.admin.common import new_uuid

    logger = log or logging.getLogger("wai.registry")
    desired = {m.name for m in models}

    for mc in models:
        row = await db.fetchone(
            "SELECT id, source, deleted_at FROM models WHERE name = ?",
            (mc.name,),
        )
        aliases = ",".join(mc.aliases)
        model_type = mc.type or "chat"
        if row is None:
            mid = new_uuid()
            await db.execute(
                """INSERT INTO models (id, name, provider, model_type, base_url, max_context_tokens,
                                       input_price_per_1m, output_price_per_1m, azure_deployment,
                                       azure_api_version, gcp_project, gcp_location, aliases, timeout,
                                       strategy, max_retries, is_active, source, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'yaml',
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
                (
                    mid,
                    mc.name,
                    mc.provider,
                    model_type,
                    mc.base_url,
                    mc.max_context_tokens,
                    mc.pricing.input_per_1m,
                    mc.pricing.output_per_1m,
                    mc.azure_deployment,
                    mc.azure_api_version,
                    mc.gcp_project,
                    mc.gcp_location,
                    aliases,
                    mc.timeout,
                    mc.strategy,
                    mc.max_retries,
                ),
            )
            if mc.api_key:
                enc = encrypt_string(mc.api_key, enc_key, f"model:{mid}".encode())
                await db.execute(
                    "UPDATE models SET api_key_encrypted = ? WHERE id = ?",
                    (enc, mid),
                )
            await db.commit()
            continue

        if row["source"] != "yaml":
            continue

        await db.execute(
            """UPDATE models SET provider = ?, model_type = ?, base_url = ?, max_context_tokens = ?,
                                  input_price_per_1m = ?, output_price_per_1m = ?, azure_deployment = ?,
                                  azure_api_version = ?, gcp_project = ?, gcp_location = ?, aliases = ?,
                                  timeout = ?, strategy = ?, max_retries = ?, is_active = 1,
                                  deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (
                mc.provider,
                model_type,
                mc.base_url,
                mc.max_context_tokens,
                mc.pricing.input_per_1m,
                mc.pricing.output_per_1m,
                mc.azure_deployment,
                mc.azure_api_version,
                mc.gcp_project,
                mc.gcp_location,
                aliases,
                mc.timeout,
                mc.strategy,
                mc.max_retries,
                row["id"],
            ),
        )
        if mc.api_key:
            enc = encrypt_string(mc.api_key, enc_key, f"model:{row['id']}".encode())
            await db.execute(
                "UPDATE models SET api_key_encrypted = ? WHERE id = ?",
                (enc, row["id"]),
            )
        await db.commit()

    stale = await db.fetchall(
        "SELECT id, name FROM models WHERE source = 'yaml' AND deleted_at IS NULL"
    )
    for row in stale:
        if row["name"] not in desired:
            await db.execute(
                "UPDATE models SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
                (row["id"],),
            )
            logger.info("soft-deleted stale yaml model: %s", row["name"])
    await db.commit()

    org_rows = await db.fetchall(
        "SELECT id FROM organizations WHERE deleted_at IS NULL"
    )
    for mc in models:
        for org in org_rows:
            granted = await db.fetchone(
                "SELECT 1 FROM org_model_access WHERE org_id = ? AND model_name = ?",
                (org["id"], mc.name),
            )
            if not granted:
                await db.execute(
                    "INSERT INTO org_model_access (id, org_id, model_name) VALUES (?, ?, ?)",
                    (new_uuid(), org["id"], mc.name),
                )
    await db.commit()


def _host_of(url: str) -> tuple[str, int | None]:
    """(hostname, effective port) of ``url``; ("", None) when unparsable."""
    try:
        parts = urlsplit((url or "").strip())
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return "", None
    if port is None:
        port = {"https": 443, "http": 80}.get((parts.scheme or "").lower())
    return host, port


def same_host(a: str, b: str) -> bool:
    """True when both URLs point at the same host and port (so a key may be shared)."""
    ha, hb = _host_of(a), _host_of(b)
    return bool(ha[0]) and ha == hb


def _decrypt(ciphertext: str | None, enc_key: bytes, aad: str, what: str, logger: logging.Logger) -> str:
    if not ciphertext:
        return ""
    try:
        return decrypt_string(ciphertext, enc_key, aad.encode())
    except Exception as exc:
        logger.error("failed to decrypt api key for %s: %s", what, exc)
        return ""


async def load_db_into_registry(
    db: Database,
    registry: Registry,
    enc_key: bytes,
    log: logging.Logger | None = None,
) -> None:
    """Rebuild the registry from active DB models and their active deployments.

    DB models take precedence over YAML. Models deactivated or deleted in the DB are
    removed; YAML models without any DB row are kept. The swap is atomic: on a DB error
    the registry is left unchanged and the exception propagates.

    Deployment API keys: a deployment's own key (AAD ``model_deployment:{id}``) is used when
    set. A deployment with no stored key inherits the parent model's key only when its
    base_url has the same host and port as the model's base_url, so a key is never handed to
    a different host. A DB model with no DB deployments keeps the deployments of the YAML
    model of the same name (YAML deployments are not synced to the DB).
    """
    logger = log or logging.getLogger("wai.registry")
    rows = await db.fetchall(
        """SELECT * FROM models WHERE deleted_at IS NULL AND is_active = 1"""
    )
    # Deleted dashboard rows must not shadow a YAML model of the same name.
    name_rows = await db.fetchall(
        "SELECT name FROM models WHERE deleted_at IS NULL OR source = 'yaml'"
    )
    dep_rows = await db.fetchall(
        """SELECT d.id, d.model_id, d.name, d.provider, d.base_url, d.api_key_encrypted,
                  d.azure_deployment, d.azure_api_version, d.gcp_project, d.gcp_location,
                  d.weight, d.priority
           FROM model_deployments d
           JOIN models m ON m.id = d.model_id
           WHERE d.is_active = 1 AND d.deleted_at IS NULL
             AND m.is_active = 1 AND m.deleted_at IS NULL
           ORDER BY d.model_id, d.priority, d.id"""
    )
    id_to_name = {row["id"]: row["name"] for row in rows}
    deps_by_model: dict[str, list[dict[str, Any]]] = {}
    for dep in dep_rows:
        deps_by_model.setdefault(dep["model_id"], []).append(dict(dep))

    models: list[Model] = []
    for row in rows:
        api_key = _decrypt(
            row["api_key_encrypted"], enc_key, f"model:{row['id']}", f"model {row['name']}", logger
        )
        base_url = row["base_url"] or ""

        deployments: list[Deployment] = []
        for dep in deps_by_model.get(row["id"], []):
            dep_key = _decrypt(
                dep["api_key_encrypted"], enc_key, f"model_deployment:{dep['id']}",
                f"deployment {row['name']}/{dep['name']}", logger,
            )
            if not dep["api_key_encrypted"] and api_key and same_host(dep["base_url"], base_url):
                dep_key = api_key
            deployments.append(
                Deployment(
                    name=dep["name"] or "",
                    provider=dep["provider"] or "",
                    base_url=dep["base_url"] or "",
                    api_key=dep_key,
                    azure_deployment=dep["azure_deployment"] or "",
                    azure_api_version=dep["azure_api_version"] or "",
                    gcp_project=dep["gcp_project"] or "",
                    gcp_location=dep["gcp_location"] or "",
                    weight=int(dep["weight"] if dep["weight"] is not None else 1),
                    priority=int(dep["priority"] or 0),
                )
            )
        if not deployments:
            yaml_model = registry.yaml_model(row["name"])
            if yaml_model is not None and yaml_model.deployments:
                deployments = list(yaml_model.deployments)

        aliases_raw = row["aliases"] or ""
        aliases = [a.strip() for a in aliases_raw.split(",") if a.strip()]
        timeout = parse_duration(row["timeout"] or "") or timedelta(0)
        fallback_name = ""
        fallback_id = row["fallback_model_id"] if "fallback_model_id" in row.keys() else None
        if fallback_id:
            fallback_name = id_to_name.get(fallback_id, "")

        models.append(
            Model(
                name=row["name"],
                provider=row["provider"],
                type=row["model_type"] or "chat",
                base_url=base_url,
                api_key=api_key,
                aliases=aliases,
                max_context_tokens=int(row["max_context_tokens"] or 0),
                pricing=PricingConfig(
                    input_per_1m=float(row["input_price_per_1m"] or 0),
                    output_per_1m=float(row["output_price_per_1m"] or 0),
                ),
                azure_deployment=row["azure_deployment"] or "",
                azure_api_version=row["azure_api_version"] or "",
                gcp_project=row["gcp_project"] or "",
                gcp_location=row["gcp_location"] or "",
                timeout=timeout,
                strategy=row["strategy"] or "",
                max_retries=int(row["max_retries"] or 0),
                fallback_model_name=fallback_name,
                deployments=deployments,
                source=row["source"] or "api",
            )
        )
    registry.replace_db_models(models, [r["name"] for r in name_rows], logger)
