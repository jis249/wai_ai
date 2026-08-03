"""Persist / load auto-router settings (YAML defaults + DB overlay)."""

from __future__ import annotations

import json
import logging
from typing import Any

from wai.api.admin import repository as repo
from wai.config.models import AutoRouterSettings
from wai.db.connection import Database
from wai.proxy.auto_router import AutoRouterConfig

SETTINGS_KEY = "auto_router"
log = logging.getLogger("wai.auto_router.settings")


def config_from_yaml(settings: AutoRouterSettings) -> AutoRouterConfig:
    return AutoRouterConfig(
        enabled=settings.enabled,
        default_model=settings.default_model,
        classifier_model=settings.classifier_model,
        classifier_timeout_seconds=settings.classifier_timeout_seconds,
        complex_mode=settings.complex_mode,
        complex_model=settings.complex_model,
    )


async def load_auto_router_config(
    db: Database,
    yaml_settings: AutoRouterSettings,
) -> AutoRouterConfig:
    base = config_from_yaml(yaml_settings)
    raw = await repo.get_setting(db, SETTINGS_KEY)
    if not raw:
        return base
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("invalid auto_router settings JSON in DB; using YAML defaults")
        return base
    if not isinstance(data, dict):
        return base
    return AutoRouterConfig.from_dict(data, base=base)


async def save_auto_router_config(db: Database, config: AutoRouterConfig) -> AutoRouterConfig:
    await repo.set_setting(db, SETTINGS_KEY, json.dumps(config.to_dict()))
    return config


def apply_to_proxy(proxy_handler: Any, config: AutoRouterConfig) -> None:
    if proxy_handler is None:
        return
    proxy_handler.auto_router.config = config
