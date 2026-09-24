"""Anthropic Messages API <-> OpenAI chat completions translation (pure functions, no I/O).

Documented lossy points:
- ``top_k``, ``thinking``, ``cache_control``, ``service_tier`` and other Anthropic-only fields are dropped.
- ``thinking`` / ``redacted_thinking`` blocks in assistant history are dropped.
- Server tools (``{"type": "web_search_20250305", ...}`` without ``input_schema``) are dropped; only
  client tools with an ``input_schema`` become OpenAI functions.
- ``tool_result.is_error`` has no OpenAI equivalent: the tool message content is prefixed with ``Error: ``.
- Images inside a ``tool_result`` are moved into a user message right after the tool messages,
  because OpenAI tool messages only carry text.
- OpenAI does not say which stop sequence matched, so ``stop_sequence`` is always ``null`` and a
  stop-sequence hit is reported as ``end_turn``.
- ``finish_reason: content_filter`` maps to ``stop_reason: refusal``.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any


class TranslationError(ValueError):
    """The Anthropic request cannot be translated (reported as a 400 invalid_request_error)."""


# --- request -------------------------------------------------------------------------------------


def _text_of_blocks(blocks: Any, sep: str = "\n\n") -> str:
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        return ""
    parts = []
    for b in blocks:
        if isinstance(b, str):
            parts.append(b)
        elif isinstance(b, dict) and b.get("type", "text") == "text" and isinstance(b.get("text"), str):
            parts.append(b["text"])
    return sep.join(parts)


def _image_part(block: dict[str, Any]) -> dict[str, Any]:
    source = block.get("source")
    if not isinstance(source, dict):
        raise TranslationError("image block requires a source")
    stype = source.get("type")
    if stype == "base64":
        media_type = source.get("media_type") or "image/png"
        data = source.get("data")
        if not isinstance(data, str) or not data:
            raise TranslationError("image source.data is required for base64 images")
        url = f"data:{media_type};base64,{data}"
    elif stype == "url":
        url = source.get("url")
        if not isinstance(url, str) or not url:
            raise TranslationError("image source.url is required for url images")
    else:
        raise TranslationError(f"unsupported image source type: {stype!r}")
    return {"type": "image_url", "image_url": {"url": url}}


def _document_part(block: dict[str, Any]) -> dict[str, Any]:
    source = block.get("source")
    if not isinstance(source, dict):
        raise TranslationError("document block requires a source")
    stype = source.get("type")
    if stype == "text":
        return {"type": "text", "text": str(source.get("data") or "")}
    if stype == "content":
        return {"type": "text", "text": _text_of_blocks(source.get("content"))}
    if stype == "base64":
        media_type = source.get("media_type") or "application/pdf"
        return {
            "type": "file",
            "file": {
                "filename": str(block.get("title") or "document.pdf"),
                "file_data": f"data:{media_type};base64,{source.get('data') or ''}",
            },
        }
    raise TranslationError(f"unsupported document source type: {stype!r}")


def _user_parts(blocks: list[Any]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for b in blocks:
        if isinstance(b, str):
            parts.append({"type": "text", "text": b})
            continue
        if not isinstance(b, dict):
            continue
        btype = b.get("type")
        if btype == "text":
            parts.append({"type": "text", "text": str(b.get("text") or "")})
        elif btype == "image":
            parts.append(_image_part(b))
        elif btype == "document":
            parts.append(_document_part(b))
        elif btype in ("thinking", "redacted_thinking"):
            continue
        elif btype == "search_result":
            parts.append({"type": "text", "text": _text_of_blocks(b.get("content"))})
        else:
            raise TranslationError(f"unsupported content block type in user message: {btype!r}")
    return parts


def _collapse(parts: list[dict[str, Any]]) -> str | list[dict[str, Any]]:
    """Text-only content becomes a plain string (widest backend compatibility)."""
    if all(p.get("type") == "text" for p in parts):
        return "\n\n".join(p["text"] for p in parts)
    return parts


def _tool_result_messages(block: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    tool_use_id = block.get("tool_use_id")
    if not isinstance(tool_use_id, str) or not tool_use_id:
        raise TranslationError("tool_result.tool_use_id is required")
    content = block.get("content")
    images: list[dict[str, Any]] = []
    if content is None:
        text = ""
    elif isinstance(content, str):
        text = content
    elif isinstance(content, list):
        texts = []
        for c in content:
            if isinstance(c, str):
                texts.append(c)
            elif isinstance(c, dict):
                ctype = c.get("type")
                if ctype == "text":
                    texts.append(str(c.get("text") or ""))
                elif ctype == "image":
                    images.append(_image_part(c))
                elif ctype == "search_result":
                    texts.append(_text_of_blocks(c.get("content")))
                elif ctype == "document":
                    part = _document_part(c)
                    if part["type"] == "text":
                        texts.append(part["text"])
        text = "\n".join(texts)
    else:
        text = json.dumps(content)
    if block.get("is_error"):
        text = f"Error: {text}" if text else "Error"
    return {"role": "tool", "tool_call_id": tool_use_id, "content": text}, images


def _assistant_message(content: Any) -> dict[str, Any]:
    if isinstance(content, str):
        return {"role": "assistant", "content": content}
    if not isinstance(content, list):
        raise TranslationError("message content must be a string or a list of content blocks")
    texts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for b in content:
        if isinstance(b, str):
            texts.append(b)
            continue
        if not isinstance(b, dict):
            continue
        btype = b.get("type")
        if btype == "text":
            texts.append(str(b.get("text") or ""))
        elif btype == "tool_use":
            tool_input = b.get("input")
            tool_calls.append(
                {
                    "id": str(b.get("id") or f"toolu_{uuid.uuid4().hex[:24]}"),
                    "type": "function",
                    "function": {
                        "name": str(b.get("name") or ""),
                        "arguments": json.dumps(tool_input if tool_input is not None else {}),
                    },
                }
            )
        # thinking, redacted_thinking, server_tool_use, *_tool_result and anything else: dropped.
    msg: dict[str, Any] = {"role": "assistant", "content": "".join(texts) if texts else None}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    elif msg["content"] is None:
        msg["content"] = ""
    return msg


def _translate_messages(messages: Any) -> list[dict[str, Any]]:
    if not isinstance(messages, list):
        raise TranslationError("messages: Field required")
    out: list[dict[str, Any]] = []
    for i, m in enumerate(messages):
        if not isinstance(m, dict):
            raise TranslationError(f"messages.{i}: must be an object")
        role = m.get("role")
        content = m.get("content")
        if role == "assistant":
            out.append(_assistant_message(content))
            continue
        if role != "user":
            raise TranslationError(f"messages.{i}.role: must be 'user' or 'assistant'")
        if isinstance(content, str):
            out.append({"role": "user", "content": content})
            continue
        if not isinstance(content, list):
            raise TranslationError(f"messages.{i}.content: must be a string or a list of content blocks")
        # tool_result blocks become tool messages, which OpenAI requires directly after the
        # assistant tool_calls message, so they are emitted before the remaining user content.
        tool_msgs: list[dict[str, Any]] = []
        tool_images: list[dict[str, Any]] = []
        rest: list[Any] = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                tmsg, imgs = _tool_result_messages(b)
                tool_msgs.append(tmsg)
                tool_images.extend(imgs)
            else:
                rest.append(b)
        out.extend(tool_msgs)
        parts = tool_images + _user_parts(rest)
        if parts:
            out.append({"role": "user", "content": _collapse(parts)})
        elif not tool_msgs:
            out.append({"role": "user", "content": ""})
    return out


def _translate_tools(tools: Any) -> list[dict[str, Any]]:
    if not isinstance(tools, list):
        return []
    out = []
    for t in tools:
        if not isinstance(t, dict) or not t.get("name"):
            continue
        schema = t.get("input_schema")
        if not isinstance(schema, dict):
            continue  # server tool (web_search, bash, text_editor, ...): no client-side schema
        fn: dict[str, Any] = {"name": str(t["name"]), "parameters": schema}
        if t.get("description"):
            fn["description"] = str(t["description"])
        out.append({"type": "function", "function": fn})
    return out


def _translate_tool_choice(choice: Any) -> tuple[Any, bool]:
    """Returns (openai tool_choice or None, disable_parallel_tool_use)."""
    if not isinstance(choice, dict):
        return None, False
    ctype = choice.get("type")
    disable_parallel = bool(choice.get("disable_parallel_tool_use"))
    if ctype == "auto":
        return "auto", disable_parallel
    if ctype == "any":
        return "required", disable_parallel
    if ctype == "none":
        return "none", False
    if ctype == "tool":
        name = choice.get("name")
        if not isinstance(name, str) or not name:
            raise TranslationError("tool_choice.name is required when tool_choice.type is 'tool'")
        return {"type": "function", "function": {"name": name}}, disable_parallel
    raise TranslationError(f"tool_choice.type: unsupported value {ctype!r}")


def anthropic_to_openai(body: Any) -> dict[str, Any]:
    """Translate an Anthropic Messages request body into an OpenAI chat completions body."""
    if not isinstance(body, dict):
        raise TranslationError("request body must be a JSON object")
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise TranslationError("model: Field required")
    max_tokens = body.get("max_tokens")
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int):
        raise TranslationError("max_tokens: Field required")
    if max_tokens < 1:
        raise TranslationError("max_tokens: must be greater than or equal to 1")

    messages: list[dict[str, Any]] = []
    system = body.get("system")
    if system:
        system_text = _text_of_blocks(system)
        if system_text:
            messages.append({"role": "system", "content": system_text})
    messages.extend(_translate_messages(body.get("messages")))

    out: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens}
    for key in ("temperature", "top_p"):
        if isinstance(body.get(key), (int, float)) and not isinstance(body.get(key), bool):
            out[key] = body[key]
    stop = body.get("stop_sequences")
    if isinstance(stop, list) and stop:
        out["stop"] = [str(s) for s in stop]
    if body.get("stream"):
        out["stream"] = True

    tools = _translate_tools(body.get("tools"))
    if tools:
        out["tools"] = tools
        choice, disable_parallel = _translate_tool_choice(body.get("tool_choice"))
        if choice is not None:
            out["tool_choice"] = choice
        if disable_parallel:
            out["parallel_tool_calls"] = False
    elif isinstance(body.get("tool_choice"), dict):
        _translate_tool_choice(body["tool_choice"])  # still validate the shape

    metadata = body.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("user_id"), str) and metadata["user_id"]:
        out["user"] = metadata["user_id"]
    return out


# --- token estimate ------------------------------------------------------------------------------


def _chars(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value)
    if isinstance(value, list):
        return sum(_chars(v) for v in value)
    if isinstance(value, dict):
        btype = value.get("type")
        if btype == "text":
            return _chars(value.get("text"))
        if btype == "image":
            return 0  # counted separately
        if btype == "tool_use":
            return _chars(value.get("name")) + len(json.dumps(value.get("input") or {}))
        if btype == "tool_result":
            return _chars(value.get("content"))
        if btype in ("thinking", "redacted_thinking"):
            return _chars(value.get("thinking"))
        return len(json.dumps(value))
    return len(str(value))


# Rough flat cost per image; real Claude image cost depends on resolution.
_IMAGE_TOKENS = 1000


def _count_images(value: Any) -> int:
    if isinstance(value, list):
        return sum(_count_images(v) for v in value)
    if isinstance(value, dict):
        if value.get("type") == "image":
            return 1
        if value.get("type") == "tool_result":
            return _count_images(value.get("content"))
        if "content" in value:
            return _count_images(value.get("content"))
    return 0


def estimate_input_tokens(body: dict[str, Any]) -> int:
    """Heuristic input-token estimate: characters / 4 (same as the auto router) plus a flat image cost.

    This is an estimate, not the tokenizer count of the routed model.
    """
    chars = _chars(body.get("system"))
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    for m in messages:
        if isinstance(m, dict):
            chars += _chars(m.get("content"))
    tools = body.get("tools")
    if isinstance(tools, list) and tools:
        chars += len(json.dumps(tools))
    est = max(1, chars // 4) if chars else 0
    return est + _IMAGE_TOKENS * _count_images(messages)


# --- response ------------------------------------------------------------------------------------

_STOP_REASONS = {
    "stop": "end_turn",
    "length": "max_tokens",
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "content_filter": "refusal",
}


def map_stop_reason(finish_reason: Any, has_tool_use: bool) -> str:
    reason = _STOP_REASONS.get(finish_reason or "", "end_turn")
    # Some backends report "stop" even when they returned tool calls; Anthropic clients run tools
    # only on stop_reason == "tool_use".
    if has_tool_use and reason == "end_turn":
        return "tool_use"
    return reason


def new_message_id(openai_id: Any = None) -> str:
    if isinstance(openai_id, str) and openai_id:
        tail = re.sub(r"[^A-Za-z0-9_]", "", openai_id.removeprefix("chatcmpl-"))
        if tail:
            return f"msg_{tail[:48]}"
    return f"msg_{uuid.uuid4().hex[:24]}"


def parse_tool_input(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {"_raw": raw if isinstance(raw, str) else str(raw)}
    return parsed if isinstance(parsed, dict) else {"_raw": raw}


def map_usage(usage: Any) -> dict[str, int]:
    usage = usage if isinstance(usage, dict) else {}
    prompt = int(usage.get("prompt_tokens") or 0)
    completion = int(usage.get("completion_tokens") or 0)
    details = usage.get("prompt_tokens_details")
    cached = int(details.get("cached_tokens") or 0) if isinstance(details, dict) else 0
    cached = min(max(cached, 0), prompt)
    # Anthropic input_tokens excludes cache reads.
    return {
        "input_tokens": prompt - cached,
        "output_tokens": completion,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": cached,
    }


def openai_to_anthropic(doc: dict[str, Any], model: str) -> dict[str, Any]:
    """Translate a non-streaming OpenAI chat completion into an Anthropic message."""
    choices = doc.get("choices") if isinstance(doc.get("choices"), list) else []
    choice = choices[0] if choices and isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}

    content: list[dict[str, Any]] = []
    text = message.get("content")
    if isinstance(text, list):  # some backends return content parts
        text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
    if isinstance(text, str) and text:
        content.append({"type": "text", "text": text})
    refusal = message.get("refusal")
    if isinstance(refusal, str) and refusal and not text:
        content.append({"type": "text", "text": refusal})

    tool_calls = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else []
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        content.append(
            {
                "type": "tool_use",
                "id": str(tc.get("id") or f"toolu_{uuid.uuid4().hex[:24]}"),
                "name": str(fn.get("name") or ""),
                "input": parse_tool_input(fn.get("arguments")),
            }
        )
    has_tool_use = any(b["type"] == "tool_use" for b in content)
    stop_reason = map_stop_reason(choice.get("finish_reason"), has_tool_use)
    if refusal and not has_tool_use:
        stop_reason = "refusal"
    if not content:
        content.append({"type": "text", "text": ""})
    return {
        "id": new_message_id(doc.get("id")),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": map_usage(doc.get("usage")),
    }


# --- errors --------------------------------------------------------------------------------------

_STATUS_ERROR_TYPES = {
    400: "invalid_request_error",
    401: "authentication_error",
    402: "billing_error",
    403: "permission_error",
    404: "not_found_error",
    413: "request_too_large",
    422: "invalid_request_error",
    429: "rate_limit_error",
    500: "api_error",
    502: "api_error",
    503: "overloaded_error",
    504: "timeout_error",
    529: "overloaded_error",
}


def error_type_for_status(status: int) -> str:
    if status in _STATUS_ERROR_TYPES:
        return _STATUS_ERROR_TYPES[status]
    return "api_error" if status >= 500 else "invalid_request_error"


def error_type_from_payload(err: Any) -> str:
    """Best-effort Anthropic error type for an error without an HTTP status (mid-stream)."""
    if not isinstance(err, dict):
        return "api_error"
    code = err.get("code")
    if isinstance(code, int) or (isinstance(code, str) and code.isdigit()):
        return error_type_for_status(int(code))
    for key in ("status", "status_code"):
        if isinstance(err.get(key), int):
            return error_type_for_status(err[key])
    hint = f"{err.get('type') or ''} {code or ''}".lower()
    for needle, etype in (
        ("rate_limit", "rate_limit_error"),
        ("limit_reached", "rate_limit_error"),
        ("budget", "rate_limit_error"),
        ("overloaded", "overloaded_error"),
        ("unavailable", "overloaded_error"),
        ("auth", "authentication_error"),
        ("api_key", "authentication_error"),
        ("permission", "permission_error"),
        ("access_denied", "permission_error"),
        ("forbidden", "permission_error"),
        ("not_found", "not_found_error"),
        ("invalid_request", "invalid_request_error"),
        ("bad_request", "invalid_request_error"),
        ("context_length", "invalid_request_error"),
        ("timeout", "timeout_error"),
    ):
        if needle in hint:
            return etype
    return "api_error"


def extract_error(payload: Any) -> tuple[dict[str, Any] | None, str]:
    """(inner error dict or None, message) from an OpenAI/WAI error body."""
    if isinstance(payload, (bytes, bytearray)):
        payload = payload.decode("utf-8", errors="replace")
    if isinstance(payload, str):
        text = payload
        try:
            payload = json.loads(payload)
        except ValueError:
            return None, " ".join(text.split())[:500]
    if isinstance(payload, dict):
        err = payload.get("error", payload.get("detail"))
        if isinstance(err, dict):
            msg = err.get("message")
            return err, str(msg) if msg else json.dumps(err)[:500]
        if isinstance(err, str):
            return None, err
        if isinstance(payload.get("message"), str):
            return payload, payload["message"]
    return None, "upstream error"


def anthropic_error(error_type: str, message: str, request_id: str = "") -> dict[str, Any]:
    body: dict[str, Any] = {"type": "error", "error": {"type": error_type, "message": message}}
    if request_id:
        body["request_id"] = request_id
    return body
