"""Alert event/rule/channel data types and built-in defaults."""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

KIND_BUDGET = "budget.threshold"
KIND_MODEL_HEALTH = "model.health"
KIND_DEPLOYMENT_CIRCUIT = "deployment.circuit"
KIND_ERROR_RATE = "error_rate.high"
KIND_DIGEST = "digest.daily"
KIND_PRICING_SYNC = "pricing.sync"
KIND_TEST = "test"

EVENT_KINDS = (
    KIND_BUDGET, KIND_MODEL_HEALTH, KIND_DEPLOYMENT_CIRCUIT, KIND_ERROR_RATE, KIND_DIGEST, KIND_PRICING_SYNC, KIND_TEST,
)
# Kinds that have a configurable rule ("test" always goes straight to the chosen channel).
# Any other kind passed to emit_alert is still delivered: to its org's channels (if any)
# and always to the platform channels, at its own severity (see AlertRule.default).
RULE_KINDS = (KIND_BUDGET, KIND_ERROR_RATE, KIND_MODEL_HEALTH, KIND_DEPLOYMENT_CIRCUIT, KIND_PRICING_SYNC, KIND_DIGEST)
# Org-scoped rules: model health and circuits are platform concerns (models are shared).
ORG_RULE_KINDS = (KIND_BUDGET, KIND_ERROR_RATE, KIND_DIGEST)

SEVERITIES = ("info", "warning", "critical")
SEVERITY_RANK = {s: i for i, s in enumerate(SEVERITIES)}

CHANNEL_KINDS = ("teams", "slack", "webhook")

# Default rule settings per kind. `params` is kind-specific.
DEFAULT_RULES: dict[str, dict[str, Any]] = {
    KIND_BUDGET: {
        "enabled": True,
        "severity_min": "warning",
        "cooldown_seconds": 86400,
        "params": {"thresholds": [80, 100]},
    },
    KIND_ERROR_RATE: {
        "enabled": True,
        "severity_min": "warning",
        "cooldown_seconds": 3600,
        "params": {"threshold_pct": 10, "min_requests": 20, "window_minutes": 15},
    },
    KIND_MODEL_HEALTH: {"enabled": True, "severity_min": "warning", "cooldown_seconds": 900, "params": {}},
    KIND_DEPLOYMENT_CIRCUIT: {"enabled": True, "severity_min": "warning", "cooldown_seconds": 900, "params": {}},
    KIND_PRICING_SYNC: {"enabled": True, "severity_min": "warning", "cooldown_seconds": 21600, "params": {}},
    KIND_DIGEST: {
        "enabled": False,
        "severity_min": "info",
        "cooldown_seconds": 3600,
        # 03:30 UTC is about 09:00 IST.
        "params": {"hour_utc": 3, "minute_utc": 30},
    },
}

_MAX_TITLE = 200
_MAX_MESSAGE = 2000
_MAX_DATA_KEYS = 30
_MAX_DATA_STR = 300
# Keys whose values must never leave the gateway in an alert.
_SENSITIVE_KEY_RE = re.compile(
    r"(secret|token|password|passwd|api[_-]?key|authorization|auth|cookie|prompt|messages|content|url_enc|credential)",
    re.IGNORECASE,
)


def is_known_kind(kind: str) -> bool:
    return kind in EVENT_KINDS


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def parse_iso(value: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _sanitize_value(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:_MAX_DATA_STR]
    if depth >= 2:
        return str(value)[:_MAX_DATA_STR]
    if isinstance(value, dict):
        return sanitize_data(value, depth + 1)
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(v, depth + 1) for v in list(value)[:20]]
    return str(value)[:_MAX_DATA_STR]


def sanitize_data(data: dict[str, Any] | None, depth: int = 0) -> dict[str, Any]:
    """Keep alert data small and JSON-safe; drop keys that look like secrets or prompt content."""
    if not isinstance(data, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in list(data.items())[:_MAX_DATA_KEYS]:
        key = str(k)[:64]
        if _SENSITIVE_KEY_RE.search(key):
            continue
        out[key] = _sanitize_value(v, depth)
    return out


@dataclass
class AlertEvent:
    id: str
    kind: str
    severity: str
    title: str
    message: str
    org_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    dedupe_key: str | None = None
    created_at: str = ""

    @classmethod
    def create(
        cls,
        *,
        id: str,
        kind: str,
        severity: str,
        title: str,
        message: str,
        org_id: str | None = None,
        data: dict[str, Any] | None = None,
        dedupe_key: str | None = None,
        now: datetime | None = None,
    ) -> "AlertEvent":
        sev = severity if severity in SEVERITY_RANK else "info"
        return cls(
            id=id,
            kind=str(kind or "")[:64],
            severity=sev,
            title=str(title or "")[:_MAX_TITLE],
            message=str(message or "")[:_MAX_MESSAGE],
            org_id=org_id or None,
            data=sanitize_data(data),
            dedupe_key=(str(dedupe_key)[:300] if dedupe_key else None),
            created_at=iso(now or utc_now()),
        )

    def public_dict(self) -> dict[str, Any]:
        """The JSON body sent to generic webhooks."""
        return {
            "id": self.id,
            "kind": self.kind,
            "severity": self.severity,
            "title": self.title,
            "message": self.message,
            "org_id": self.org_id,
            "data": self.data,
            "created_at": self.created_at,
        }


@dataclass
class AlertRule:
    kind: str
    org_id: str | None = None
    id: str = ""
    enabled: bool = True
    severity_min: str = "warning"
    cooldown_seconds: int = 3600
    params: dict[str, Any] = field(default_factory=dict)
    channel_ids: list[str] = field(default_factory=list)
    updated_at: str = ""

    @classmethod
    def default(cls, kind: str, org_id: str | None = None) -> "AlertRule":
        # Unknown kinds: enabled, delivered at any severity, 1h cooldown per dedupe_key.
        d = copy.deepcopy(DEFAULT_RULES.get(kind) or {"enabled": True, "severity_min": "info", "cooldown_seconds": 3600, "params": {}})
        return cls(kind=kind, org_id=org_id, **d)

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "AlertRule":
        kind = row.get("kind") or ""
        base = cls.default(kind, row.get("org_id") or None)
        params = _json_obj(row.get("params"))
        merged = {**base.params, **params}
        return cls(
            kind=kind,
            org_id=row.get("org_id") or None,
            id=row.get("id") or "",
            enabled=bool(row.get("enabled")),
            severity_min=row.get("severity_min") if row.get("severity_min") in SEVERITY_RANK else base.severity_min,
            cooldown_seconds=max(0, int(row.get("cooldown_seconds") or 0)),
            params=merged,
            channel_ids=[str(x) for x in _json_list(row.get("channel_ids"))],
            updated_at=row.get("updated_at") or "",
        )

    def allows(self, severity: str) -> bool:
        return self.enabled and SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(self.severity_min, 0)


@dataclass
class AlertChannel:
    id: str
    org_id: str | None
    name: str
    kind: str
    url: str  # decrypted; never returned by the API
    secret: str = ""
    enabled: bool = True


def _json_obj(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def _json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    try:
        v = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return v if isinstance(v, list) else []
