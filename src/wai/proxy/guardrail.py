"""Local pre-call guardrails (PII patterns and tool-name denylist)."""

from __future__ import annotations

import re
from typing import Any

from wai.api.admin.common import api_error

_CC_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")


def _collect_text(envelope: dict[str, Any]) -> str:
    parts: list[str] = []
    prompt = envelope.get("prompt")
    if isinstance(prompt, str):
        parts.append(prompt)
    input_text = envelope.get("input")
    if isinstance(input_text, str):
        parts.append(input_text)
    for msg in envelope.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
    return "\n".join(parts)


def _tool_names(envelope: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for tool in envelope.get("tools") or []:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        name = fn.get("name") if isinstance(fn, dict) else None
        if isinstance(name, str) and name:
            names.append(name)
    return names


def apply_org_guardrails(envelope: dict[str, Any], *, pii_enabled: bool, tool_denylist: str) -> None:
    deny = [t.strip() for t in (tool_denylist or "").split(",") if t.strip()]
    if deny:
        blocked = [n for n in _tool_names(envelope) if n in deny]
        if blocked:
            raise api_error(400, "guardrail_blocked", f"tool not allowed: {', '.join(blocked)}")
    if not pii_enabled:
        return
    text = _collect_text(envelope)
    if _SSN_RE.search(text) or _CC_RE.search(text):
        raise api_error(400, "guardrail_blocked", "request blocked by PII policy")
