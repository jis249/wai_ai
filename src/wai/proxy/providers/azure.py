"""Azure OpenAI / Microsoft Foundry adapter."""

from __future__ import annotations

import json
import time

from wai.proxy.providers.base import Adapter
from wai.proxy.registry import Model


def is_foundry_project_endpoint(base_url: str) -> bool:
    """Microsoft Foundry project endpoints use /openai/v1, not deployments."""
    return "/api/projects/" in (base_url or "").lower()


def requires_responses_api(model: Model) -> bool:
    """Codex deployments on Foundry reject /chat/completions."""
    return _is_codex_name(model.name, model.azure_deployment)


def _is_codex_name(name: str, deployment: str = "") -> bool:
    return "codex" in (name or "").lower() or "codex" in (deployment or "").lower()


class AzureAdapter:
    def transform_request(self, body: bytes, model: Model) -> bytes:
        try:
            doc = json.loads(body)
        except json.JSONDecodeError:
            return body
        if not isinstance(doc, dict):
            return body

        if requires_responses_api(model):
            return json.dumps(_chat_to_responses_request(doc, model)).encode()

        if _is_fixed_temperature_model(model):
            doc.pop("temperature", None)
        if not _requires_max_completion_tokens(model):
            return json.dumps(doc).encode()
        if "max_tokens" in doc and "max_completion_tokens" not in doc:
            doc["max_completion_tokens"] = doc.pop("max_tokens")
        return json.dumps(doc).encode()

    def transform_url(self, base_url: str, upstream_path: str, model: Model) -> str:
        path = upstream_path.lstrip("/")
        if is_foundry_project_endpoint(base_url):
            if requires_responses_api(model) and path == "chat/completions":
                path = "responses"
            return f"{base_url.rstrip('/')}/openai/v1/{path}"
        version = model.azure_api_version or "2024-10-21"
        deployment = model.azure_deployment or model.name
        return (
            f"{base_url.rstrip('/')}/openai/deployments/{deployment}/"
            f"{path}?api-version={version}"
        )

    def set_headers(self, headers: dict[str, str], model: Model) -> dict[str, str]:
        out = {k: v for k, v in headers.items() if k.lower() != "authorization"}
        if model.api_key:
            out["api-key"] = model.api_key
            if is_foundry_project_endpoint(model.base_url):
                out["Authorization"] = f"Bearer {model.api_key}"
        return out

    def transform_response(self, body: bytes) -> bytes:
        converted = _responses_to_chat_completion(body)
        return converted if converted is not None else body

    def transform_stream_line(self, line: bytes) -> bytes | None:
        return _responses_stream_to_chat(line)


def _requires_max_completion_tokens(model: Model) -> bool:
    name = model.name.lower()
    deployment = (model.azure_deployment or "").lower()
    return any(
        value.startswith(prefix)
        for value in (name, deployment)
        for prefix in ("gpt-5", "gpt-6")
    )


def _is_fixed_temperature_model(model: Model) -> bool:
    name = (model.name or "").lower()
    deployment = (model.azure_deployment or "").lower()
    return name.startswith("gpt-6") or deployment.startswith("gpt-6")


def _message_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif isinstance(block, dict) and isinstance(block.get("content"), str):
                parts.append(block["content"])
        return "".join(parts)
    return ""


def _chat_to_responses_request(doc: dict, model: Model) -> dict:
    if "input" in doc and "messages" not in doc:
        return doc

    out: dict = {
        "model": doc.get("model") or model.azure_deployment or model.name,
    }
    messages = doc.get("messages")
    if isinstance(messages, list):
        instructions: list[str] = []
        inputs: list[dict] = []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "").lower()
            text = _message_text(msg.get("content"))
            if role == "system":
                if text.strip():
                    instructions.append(text)
                continue
            if not role:
                role = "user"
            inputs.append({"type": "message", "role": role, "content": text})
        if instructions:
            out["instructions"] = "\n\n".join(instructions)
        out["input"] = inputs
    elif doc.get("input") is not None:
        out["input"] = doc["input"]

    if doc.get("stream"):
        out["stream"] = True

    if "temperature" in doc and not _is_fixed_temperature_model(model):
        out["temperature"] = doc["temperature"]

    max_out = (
        doc.get("max_output_tokens")
        or doc.get("max_completion_tokens")
        or doc.get("max_tokens")
    )
    if max_out is not None:
        out["max_output_tokens"] = max(int(max_out), 16)
    return out


def _usage_from_responses(usage: dict | None) -> dict | None:
    if not isinstance(usage, dict):
        return None
    prompt = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    completion = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    total = int(usage.get("total_tokens") or (prompt + completion))
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


def _output_text(doc: dict) -> str:
    if isinstance(doc.get("output_text"), str):
        return doc["output_text"]
    parts: list[str] = []
    for item in doc.get("output") or []:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, str):
            parts.append(content)
            continue
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
                elif isinstance(block, str):
                    parts.append(block)
        elif isinstance(item.get("text"), str) and item.get("type") in (
            "output_text",
            "text",
        ):
            parts.append(item["text"])
    return "".join(parts)


def _responses_to_chat_completion(body: bytes) -> bytes | None:
    try:
        doc = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(doc, dict):
        return None
    if "choices" in doc:
        return None
    if doc.get("object") != "response" and "output" not in doc:
        return None

    usage = _usage_from_responses(doc.get("usage"))
    chat = {
        "id": doc.get("id") or "chatcmpl-foundry",
        "object": "chat.completion",
        "created": int(doc.get("created_at") or time.time()),
        "model": doc.get("model") or "",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": _output_text(doc)},
                "finish_reason": "stop" if doc.get("status") in (None, "completed") else doc.get("status"),
            }
        ],
    }
    if usage:
        chat["usage"] = usage
    return json.dumps(chat).encode()


def _delta_text(doc: dict) -> str:
    event = str(doc.get("type") or "")
    delta = doc.get("delta")
    if isinstance(delta, str):
        return delta
    if isinstance(delta, dict):
        if isinstance(delta.get("text"), str):
            return delta["text"]
        content = delta.get("content")
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
            return "".join(parts)
    if event.endswith("delta") and isinstance(doc.get("text"), str):
        return doc["text"]
    return ""


def _chat_chunk(
    *,
    content: str | None = None,
    finish: str | None = None,
    usage: dict | None = None,
    model: str = "",
    resp_id: str = "",
) -> bytes:
    choice = {"index": 0, "delta": {}, "finish_reason": finish}
    if content:
        choice["delta"] = {"content": content}
    doc: dict = {
        "id": resp_id or "chatcmpl-foundry",
        "object": "chat.completion.chunk",
        "choices": [choice],
    }
    if model:
        doc["model"] = model
    if usage:
        doc["usage"] = usage
    return f"data: {json.dumps(doc)}\n".encode()


def _responses_stream_to_chat(line: bytes) -> bytes | None:
    raw = line.decode("utf-8", "replace")
    stripped = raw.strip()
    if not stripped:
        return line
    if stripped.startswith("event:"):
        return None
    if stripped == "data: [DONE]":
        return line
    if not stripped.startswith("data:"):
        return line

    payload = stripped[5:].strip()
    try:
        doc = json.loads(payload)
    except json.JSONDecodeError:
        return line
    if not isinstance(doc, dict):
        return line
    if "choices" in doc:
        return line

    event = str(doc.get("type") or "")
    resp = doc.get("response") if isinstance(doc.get("response"), dict) else {}
    resp_id = str(doc.get("id") or resp.get("id") or "")
    model = str(doc.get("model") or resp.get("model") or "")

    if event in {"response.output_text.delta", "response.content_part.delta"} or (
        event.endswith(".delta") and _delta_text(doc)
    ):
        text = _delta_text(doc)
        if not text:
            return None
        return _chat_chunk(content=text, model=model, resp_id=resp_id)

    if event == "response.completed":
        usage = _usage_from_responses(resp.get("usage") or doc.get("usage"))
        return _chat_chunk(finish="stop", usage=usage, model=model, resp_id=resp_id)

    if event.startswith("response."):
        return None
    return line
