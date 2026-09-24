"""Channel payload formatters: Microsoft Teams, Slack and generic signed webhooks.

Microsoft Teams
    Both Teams delivery options accept the same body, a ``message`` with an Adaptive Card
    attachment:

    * Workflows (Power Automate "Post to a channel when a webhook request is received",
      the replacement for Office 365 connectors). Paste the workflow's HTTP POST URL
      (``https://<region>.logic.azure.com/workflows/...`` or
      ``https://<env>.environment.api.powerplatform.com/...``).
    * Legacy incoming webhooks (``https://<tenant>.webhook.office.com/...``), still
      working where Microsoft has not retired them.

    The card carries ``fallbackText`` for clients (notifications, older mobile apps)
    that cannot render Adaptive Cards.

Slack
    Incoming webhook (``https://hooks.slack.com/services/...``) with Block Kit blocks
    plus top-level ``text`` used for notifications and as fallback.

Generic webhook
    JSON body ``{id, kind, severity, title, message, org_id, data, created_at}``.
    Headers: ``X-WAI-Timestamp: <unix seconds>`` and
    ``X-WAI-Signature: sha256=<hex HMAC-SHA256(secret, raw body bytes)>``.
    Receivers should recompute the HMAC over the exact bytes received and compare in
    constant time, and may reject stale timestamps.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from wai.alerts.models import AlertEvent

_SEVERITY_LABEL = {"info": "Info", "warning": "Warning", "critical": "Critical"}
_TEAMS_COLOR = {"info": "Accent", "warning": "Warning", "critical": "Attention"}
_SLACK_EMOJI = {"info": ":information_source:", "warning": ":warning:", "critical": ":rotating_light:"}
_MAX_FACTS = 10


def _fmt_value(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:,.4g}" if abs(v) < 1e6 else f"{v:,.0f}"
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), default=str)[:300]
    return str(v)[:300]


def _facts(event: AlertEvent) -> list[tuple[str, str]]:
    facts: list[tuple[str, str]] = [("Kind", event.kind), ("Severity", _SEVERITY_LABEL.get(event.severity, event.severity))]
    if event.org_id:
        org_name = event.data.get("org_name")
        facts.append(("Organization", f"{org_name} ({event.org_id})" if org_name else event.org_id))
    else:
        facts.append(("Scope", "Platform"))
    for k, v in event.data.items():
        if len(facts) >= _MAX_FACTS or k == "org_name":
            continue
        if v is None or v == "" or isinstance(v, (dict, list)) and not v:
            continue
        facts.append((k.replace("_", " ").capitalize(), _fmt_value(v)))
    facts.append(("Time (UTC)", event.created_at))
    return facts


def fallback_text(event: AlertEvent) -> str:
    return f"[{_SEVERITY_LABEL.get(event.severity, event.severity)}] {event.title}: {event.message}"


def teams_payload(event: AlertEvent) -> dict[str, Any]:
    """Adaptive Card message for Teams Workflows and legacy incoming webhooks."""
    card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "fallbackText": fallback_text(event),
        "msteams": {"width": "Full"},
        "body": [
            {
                "type": "TextBlock",
                "text": f"{_SEVERITY_LABEL.get(event.severity, event.severity).upper()} · WAI alert",
                "weight": "Bolder",
                "size": "Small",
                "color": _TEAMS_COLOR.get(event.severity, "Default"),
            },
            {"type": "TextBlock", "text": event.title, "weight": "Bolder", "size": "Medium", "wrap": True},
            {"type": "TextBlock", "text": event.message, "wrap": True},
            {"type": "FactSet", "facts": [{"title": k, "value": v} for k, v in _facts(event)]},
        ],
    }
    return {
        "type": "message",
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}
        ],
    }


def _slack_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def slack_payload(event: AlertEvent) -> dict[str, Any]:
    """Slack incoming-webhook body: Block Kit blocks plus fallback text."""
    facts = _facts(event)
    fields = [{"type": "mrkdwn", "text": f"*{_slack_escape(k)}*\n{_slack_escape(v)}"} for k, v in facts[:10]]
    return {
        "text": _slack_escape(fallback_text(event)),
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": event.title[:150] or "WAI alert", "emoji": True}},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{_SLACK_EMOJI.get(event.severity, '')} *{_SEVERITY_LABEL.get(event.severity, event.severity)}* · "
                    f"{_slack_escape(event.message)[:2900]}",
                },
            },
            {"type": "section", "fields": fields},
            {"type": "context", "elements": [{"type": "mrkdwn", "text": f"WAI · `{_slack_escape(event.kind)}` · {event.id}"}]},
        ],
    }


def webhook_body(event: AlertEvent) -> bytes:
    """Canonical JSON bytes for generic webhooks (the exact bytes that are signed)."""
    return json.dumps(event.public_dict(), separators=(",", ":"), sort_keys=True, default=str).encode("utf-8")


def sign_body(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def verify_signature(secret: str, body: bytes, signature: str) -> bool:
    return hmac.compare_digest(sign_body(secret, body), signature or "")


def build_request(kind: str, event: AlertEvent, *, secret: str = "", timestamp: int = 0) -> tuple[bytes, dict[str, str]]:
    """Return (body bytes, headers) for a channel kind."""
    headers = {"Content-Type": "application/json", "User-Agent": "WAI-Alerts/1"}
    if kind == "teams":
        body = json.dumps(teams_payload(event), separators=(",", ":")).encode("utf-8")
    elif kind == "slack":
        body = json.dumps(slack_payload(event), separators=(",", ":")).encode("utf-8")
    else:
        body = webhook_body(event)
        headers["X-WAI-Timestamp"] = str(int(timestamp))
        headers["X-WAI-Event"] = event.kind
        if secret:
            headers["X-WAI-Signature"] = sign_body(secret, body)
    return body, headers
