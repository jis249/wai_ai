"""Local pre-call guardrails (PII patterns and tool-name denylist)."""

from __future__ import annotations

import re
from typing import Any

from wai.api.admin.common import api_error

_CC_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")


def luhn_valid(digits: str) -> bool:
    """Luhn (mod 10) checksum over a string of digits."""
    if not digits.isdigit():
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _contains_card_number(text: str) -> bool:
    """True when text has a 13-19 digit run (spaces/dashes allowed) passing Luhn."""
    for match in _CC_RE.finditer(text):
        groups = [g for g in re.split(r"[ -]+", match.group(0)) if g]
        # The regex is greedy, so also try dropping trailing digit groups
        # (e.g. "4111 1111 1111 1111 12" still contains a card number).
        for end in range(len(groups), 0, -1):
            digits = "".join(groups[:end])
            if len(digits) < 13:
                break
            if len(digits) <= 19 and len(set(digits)) > 1 and luhn_valid(digits):
                return True
    return False


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
    if _SSN_RE.search(text) or _contains_card_number(text):
        raise api_error(400, "guardrail_blocked", "request blocked by PII policy")
