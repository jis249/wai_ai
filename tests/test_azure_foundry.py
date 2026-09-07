"""Azure Foundry adapter: Codex chat->responses and stream translation."""

from __future__ import annotations

import json

from wai.proxy.providers.azure import AzureAdapter, requires_responses_api
from wai.proxy.registry import Model


FOUNDRY = "https://jis-foundry-local.services.ai.azure.com/api/projects/jis-foundry-local-proj"


def _codex() -> Model:
    return Model(
        name="gpt-5.3-codex",
        provider="azure",
        base_url=FOUNDRY,
        azure_deployment="gpt-5.3-codex",
    )


def _astra() -> Model:
    return Model(
        name="gpt-6-astra",
        provider="azure",
        base_url=FOUNDRY,
        azure_deployment="gpt-6-astra",
    )


def test_codex_uses_responses_url():
    adapter = AzureAdapter()
    url = adapter.transform_url(FOUNDRY, "chat/completions", _codex())
    assert url.endswith("/openai/v1/responses")


def test_astra_keeps_chat_url():
    adapter = AzureAdapter()
    url = adapter.transform_url(FOUNDRY, "chat/completions", _astra())
    assert url.endswith("/openai/v1/chat/completions")


def test_codex_request_maps_messages_and_max_tokens():
    adapter = AzureAdapter()
    body = json.dumps({
        "model": "gpt-5.3-codex",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 32,
        "temperature": 0.2,
    }).encode()
    out = json.loads(adapter.transform_request(body, _codex()))
    assert out["input"] == [{"type": "message", "role": "user", "content": "hi"}]
    assert out["max_output_tokens"] == 32
    assert "messages" not in out
    assert "max_tokens" not in out


def test_astra_rewrites_max_tokens():
    adapter = AzureAdapter()
    body = json.dumps({
        "model": "gpt-6-astra",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 32,
    }).encode()
    out = json.loads(adapter.transform_request(body, _astra()))
    assert out["max_completion_tokens"] == 32
    assert "max_tokens" not in out


def test_responses_body_becomes_chat_completion():
    adapter = AzureAdapter()
    raw = json.dumps({
        "id": "resp_1",
        "object": "response",
        "status": "completed",
        "model": "gpt-5.3-codex",
        "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "OK"}]}],
        "usage": {"input_tokens": 3, "output_tokens": 1, "total_tokens": 4},
    }).encode()
    out = json.loads(adapter.transform_response(raw))
    assert out["object"] == "chat.completion"
    assert out["choices"][0]["message"]["content"] == "OK"
    assert out["usage"]["prompt_tokens"] == 3
    assert out["usage"]["completion_tokens"] == 1


def test_stream_delta_becomes_chat_chunk():
    adapter = AzureAdapter()
    line = b'data: {"type":"response.output_text.delta","delta":"Hel"}\n'
    out = adapter.transform_stream_line(line)
    assert out is not None
    payload = json.loads(out.decode().split("data: ", 1)[1])
    assert payload["choices"][0]["delta"]["content"] == "Hel"


def test_requires_responses_only_for_codex():
    assert requires_responses_api(_codex())
    assert not requires_responses_api(_astra())
