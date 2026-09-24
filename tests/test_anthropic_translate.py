"""Anthropic Messages <-> OpenAI chat translation (pure functions)."""

from __future__ import annotations

import json

import pytest

from wai.proxy.anthropic.translate import (
    TranslationError,
    anthropic_to_openai,
    error_type_for_status,
    error_type_from_payload,
    estimate_input_tokens,
    extract_error,
    openai_to_anthropic,
)


def _req(**kw):
    body = {"model": "m", "max_tokens": 64, "messages": [{"role": "user", "content": "hi"}]}
    body.update(kw)
    return body


# --- request ---------------------------------------------------------------------------------


def test_minimal_request():
    out = anthropic_to_openai(_req())
    assert out == {"model": "m", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 64}


@pytest.mark.parametrize(
    "system, expected",
    [
        ("be brief", "be brief"),
        ([{"type": "text", "text": "a", "cache_control": {"type": "ephemeral"}}, {"type": "text", "text": "b"}], "a\n\nb"),
    ],
)
def test_system_string_and_blocks(system, expected):
    out = anthropic_to_openai(_req(system=system))
    assert out["messages"][0] == {"role": "system", "content": expected}
    assert out["messages"][1]["role"] == "user"


def test_sampling_params_stop_stream_metadata_and_dropped_fields():
    out = anthropic_to_openai(
        _req(
            temperature=0.2,
            top_p=0.9,
            top_k=40,
            stop_sequences=["END", "STOP"],
            stream=True,
            metadata={"user_id": "u-1"},
            thinking={"type": "enabled", "budget_tokens": 1024},
            service_tier="auto",
        )
    )
    assert out["temperature"] == 0.2 and out["top_p"] == 0.9
    assert out["stop"] == ["END", "STOP"]
    assert out["stream"] is True
    assert out["user"] == "u-1"
    for dropped in ("top_k", "thinking", "service_tier", "metadata", "stop_sequences"):
        assert dropped not in out


@pytest.mark.parametrize("bad", [{}, {"max_tokens": None}, {"max_tokens": 0}, {"max_tokens": "10"}, {"max_tokens": True}])
def test_max_tokens_required(bad):
    body = _req()
    body.pop("max_tokens")
    body.update(bad)
    with pytest.raises(TranslationError, match="max_tokens"):
        anthropic_to_openai(body)


@pytest.mark.parametrize("body", [[], {"max_tokens": 5, "messages": []}, {"model": "m", "max_tokens": 5}])
def test_invalid_bodies(body):
    with pytest.raises(TranslationError):
        anthropic_to_openai(body)


def test_invalid_role():
    with pytest.raises(TranslationError, match="role"):
        anthropic_to_openai(_req(messages=[{"role": "system", "content": "x"}]))


def test_images_base64_and_url():
    out = anthropic_to_openai(
        _req(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "AAAA"}},
                        {"type": "image", "source": {"type": "url", "url": "https://x/y.png"}},
                        {"type": "text", "text": "what is this?"},
                    ],
                }
            ]
        )
    )
    assert out["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}},
                {"type": "image_url", "image_url": {"url": "https://x/y.png"}},
                {"type": "text", "text": "what is this?"},
            ],
        }
    ]


def test_text_only_blocks_collapse_to_string():
    out = anthropic_to_openai(
        _req(messages=[{"role": "user", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}])
    )
    assert out["messages"] == [{"role": "user", "content": "a\n\nb"}]


def test_unsupported_image_source():
    with pytest.raises(TranslationError, match="image source"):
        anthropic_to_openai(
            _req(messages=[{"role": "user", "content": [{"type": "image", "source": {"type": "file", "file_id": "f"}}]}])
        )


def test_tool_use_and_tool_result_round_trip():
    out = anthropic_to_openai(
        _req(
            messages=[
                {"role": "user", "content": "weather in Paris and Rome?"},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "thinking": "hmm", "signature": "s"},
                        {"type": "text", "text": "Checking."},
                        {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Paris"}},
                        {"type": "tool_use", "id": "toolu_2", "name": "get_weather", "input": {"city": "Rome"}},
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_1", "content": "18C"},
                        {
                            "type": "tool_result",
                            "tool_use_id": "toolu_2",
                            "content": [{"type": "text", "text": "city not found"}],
                            "is_error": True,
                        },
                        {"type": "text", "text": "thanks"},
                    ],
                },
            ]
        )
    )
    msgs = out["messages"]
    assert msgs[1] == {
        "role": "assistant",
        "content": "Checking.",
        "tool_calls": [
            {"id": "toolu_1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "Paris"}'}},
            {"id": "toolu_2", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "Rome"}'}},
        ],
    }
    assert msgs[2] == {"role": "tool", "tool_call_id": "toolu_1", "content": "18C"}
    assert msgs[3] == {"role": "tool", "tool_call_id": "toolu_2", "content": "Error: city not found"}
    assert msgs[4] == {"role": "user", "content": "thanks"}
    assert len(msgs) == 5


def test_assistant_tool_use_only_has_null_content():
    out = anthropic_to_openai(
        _req(messages=[{"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "f", "input": {}}]}])
    )
    assert out["messages"][0]["content"] is None
    assert out["messages"][0]["tool_calls"][0]["function"]["arguments"] == "{}"


def test_tool_result_images_follow_tool_messages():
    out = anthropic_to_openai(
        _req(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "t1",
                            "content": [
                                {"type": "text", "text": "screenshot"},
                                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "QQ=="}},
                            ],
                        }
                    ],
                }
            ]
        )
    )
    assert out["messages"][0] == {"role": "tool", "tool_call_id": "t1", "content": "screenshot"}
    assert out["messages"][1]["role"] == "user"
    assert out["messages"][1]["content"][0]["image_url"]["url"] == "data:image/png;base64,QQ=="


def test_tools_and_tool_choice_matrix():
    tools = [
        {"name": "get_weather", "description": "Weather", "input_schema": {"type": "object", "properties": {}}},
        {"type": "web_search_20250305", "name": "web_search", "max_uses": 3},  # server tool: dropped
    ]
    expected_fn = {
        "type": "function",
        "function": {"name": "get_weather", "parameters": {"type": "object", "properties": {}}, "description": "Weather"},
    }
    cases = [
        (None, None),
        ({"type": "auto"}, "auto"),
        ({"type": "any"}, "required"),
        ({"type": "none"}, "none"),
        ({"type": "tool", "name": "get_weather"}, {"type": "function", "function": {"name": "get_weather"}}),
    ]
    for choice, expected in cases:
        kw = {"tools": tools}
        if choice is not None:
            kw["tool_choice"] = choice
        out = anthropic_to_openai(_req(**kw))
        assert out["tools"] == [expected_fn]
        assert out.get("tool_choice") == expected
        assert "parallel_tool_calls" not in out


def test_disable_parallel_tool_use():
    out = anthropic_to_openai(
        _req(
            tools=[{"name": "f", "input_schema": {"type": "object"}}],
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
        )
    )
    assert out["parallel_tool_calls"] is False


def test_tool_choice_tool_requires_name():
    with pytest.raises(TranslationError, match="tool_choice"):
        anthropic_to_openai(_req(tools=[{"name": "f", "input_schema": {}}], tool_choice={"type": "tool"}))


# --- response --------------------------------------------------------------------------------


def _completion(message, finish="stop", usage=None):
    return {
        "id": "chatcmpl-abc123",
        "object": "chat.completion",
        "model": "upstream-model",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": usage or {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


def test_text_response():
    msg = openai_to_anthropic(_completion({"role": "assistant", "content": "Hello"}), "claude-alias")
    assert msg == {
        "id": "msg_abc123",
        "type": "message",
        "role": "assistant",
        "model": "claude-alias",
        "content": [{"type": "text", "text": "Hello"}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 5, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
    }


def test_tool_use_response_and_raw_arguments():
    msg = openai_to_anthropic(
        _completion(
            {
                "role": "assistant",
                "content": "Let me check.",
                "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "f", "arguments": '{"a": 1}'}},
                    {"id": "call_2", "type": "function", "function": {"name": "g", "arguments": "{not json"}},
                ],
            },
            finish="tool_calls",
        ),
        "m",
    )
    assert msg["content"] == [
        {"type": "text", "text": "Let me check."},
        {"type": "tool_use", "id": "call_1", "name": "f", "input": {"a": 1}},
        {"type": "tool_use", "id": "call_2", "name": "g", "input": {"_raw": "{not json"}},
    ]
    assert msg["stop_reason"] == "tool_use"


@pytest.mark.parametrize(
    "finish, has_tools, expected",
    [
        ("stop", False, "end_turn"),
        ("length", False, "max_tokens"),
        ("tool_calls", True, "tool_use"),
        ("content_filter", False, "refusal"),
        (None, False, "end_turn"),
        ("stop", True, "tool_use"),  # backend said "stop" but returned tool calls
    ],
)
def test_stop_reason_mapping(finish, has_tools, expected):
    message = {"role": "assistant", "content": "x"}
    if has_tools:
        message["tool_calls"] = [{"id": "c", "type": "function", "function": {"name": "f", "arguments": "{}"}}]
    assert openai_to_anthropic(_completion(message, finish=finish), "m")["stop_reason"] == expected


def test_cached_tokens_become_cache_reads():
    usage = {"prompt_tokens": 100, "completion_tokens": 2, "prompt_tokens_details": {"cached_tokens": 60}}
    msg = openai_to_anthropic(_completion({"role": "assistant", "content": "x"}, usage=usage), "m")
    assert msg["usage"]["input_tokens"] == 40
    assert msg["usage"]["cache_read_input_tokens"] == 60


def test_empty_content_yields_empty_text_block():
    msg = openai_to_anthropic(_completion({"role": "assistant", "content": None}), "m")
    assert msg["content"] == [{"type": "text", "text": ""}]


# --- errors / estimate -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "status, etype",
    [
        (400, "invalid_request_error"),
        (401, "authentication_error"),
        (403, "permission_error"),
        (404, "not_found_error"),
        (413, "request_too_large"),
        (422, "invalid_request_error"),
        (429, "rate_limit_error"),
        (500, "api_error"),
        (502, "api_error"),
        (503, "overloaded_error"),
        (529, "overloaded_error"),
        (418, "invalid_request_error"),
    ],
)
def test_error_type_for_status(status, etype):
    assert error_type_for_status(status) == etype


@pytest.mark.parametrize(
    "err, etype",
    [
        ({"type": "rate_limit_exceeded"}, "rate_limit_error"),
        ({"code": "invalid_api_key"}, "authentication_error"),
        ({"code": 429}, "rate_limit_error"),
        ({"code": "model_access_denied"}, "permission_error"),
        ({"type": "server_error"}, "api_error"),
        (None, "api_error"),
    ],
)
def test_error_type_from_payload(err, etype):
    assert error_type_from_payload(err) == etype


def test_extract_error_shapes():
    assert extract_error(b'{"error":{"message":"nope","code":"x"}}')[1] == "nope"
    assert extract_error({"error": "plain"})[1] == "plain"
    assert extract_error("not json at all")[1] == "not json at all"


def test_estimate_input_tokens():
    body = {"system": "x" * 40, "messages": [{"role": "user", "content": "y" * 40}]}
    assert estimate_input_tokens(body) == 20
    with_image = {
        "messages": [
            {"role": "user", "content": [{"type": "image", "source": {"type": "base64", "data": "A" * 9999}}]}
        ]
    }
    assert estimate_input_tokens(with_image) == 1000
    tools = [{"name": "f", "input_schema": {}}]
    assert estimate_input_tokens({"messages": [], "tools": tools}) == len(json.dumps(tools)) // 4
