"""OpenAI SSE -> Anthropic SSE conversion (golden event sequences)."""

from __future__ import annotations

import asyncio
import json

import httpx

from wai.proxy.anthropic.stream import StreamConverter, convert_stream


def _sse_lines(*chunks) -> list[bytes]:
    out = []
    for c in chunks:
        out.append(b"data: " + (c if isinstance(c, bytes) else json.dumps(c).encode()) + b"\n")
        out.append(b"\n")
    return out


def _chunk(delta=None, finish=None, usage=None):
    doc = {"id": "chatcmpl-1", "object": "chat.completion.chunk", "choices": []}
    if delta is not None or finish is not None:
        doc["choices"] = [{"index": 0, "delta": delta or {}, "finish_reason": finish}]
    if usage is not None:
        doc["usage"] = usage
    return doc


async def _aiter(items):
    for i in items:
        yield i


def _run(items, **kw):
    conv = StreamConverter(model=kw.get("model", "m"), message_id="msg_1", input_tokens_estimate=7)

    async def go():
        return [ev async for ev in convert_stream(_aiter(items), conv)]

    return _parse(b"".join(asyncio.run(go())))


def _parse(raw: bytes) -> list[tuple[str, dict]]:
    events = []
    for block in raw.decode().split("\n\n"):
        if not block.strip():
            continue
        lines = block.split("\n")
        assert lines[0].startswith("event: ") and lines[1].startswith("data: ")
        name = lines[0][7:]
        data = json.loads(lines[1][6:])
        assert data["type"] == name
        events.append((name, data))
    return events


def test_text_and_tool_calls_golden_sequence():
    items = _sse_lines(
        _chunk({"role": "assistant", "content": ""}),
        _chunk({"content": "Hel"}),
        _chunk({"content": "lo"}),
        _chunk({"tool_calls": [{"index": 0, "id": "call_a", "type": "function", "function": {"name": "f", "arguments": ""}}]}),
        _chunk({"tool_calls": [{"index": 0, "function": {"arguments": '{"x":'}}]}),
        _chunk({"tool_calls": [{"index": 0, "function": {"arguments": "1}"}}]}),
        _chunk({"tool_calls": [{"index": 1, "id": "call_b", "function": {"name": "g", "arguments": "{}"}}]}),
        _chunk({}, finish="tool_calls"),
        _chunk(usage={"prompt_tokens": 11, "completion_tokens": 9, "total_tokens": 20}),
        b"[DONE]",
    )
    events = _run(items)
    names = [n for n, _ in events]
    assert names == [
        "message_start",
        "ping",
        "content_block_start",
        "content_block_delta",
        "content_block_delta",
        "content_block_stop",
        "content_block_start",
        "content_block_delta",
        "content_block_delta",
        "content_block_stop",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
    ]
    start = events[0][1]["message"]
    assert start["id"] == "msg_1" and start["model"] == "m" and start["content"] == []
    assert start["usage"]["input_tokens"] == 7  # estimate until the real usage arrives
    assert events[2][1] == {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}
    assert [e[1]["delta"]["text"] for e in events[3:5]] == ["Hel", "lo"]
    assert events[6][1]["content_block"] == {"type": "tool_use", "id": "call_a", "name": "f", "input": {}}
    assert events[6][1]["index"] == 1
    assert "".join(e[1]["delta"]["partial_json"] for e in events[7:9]) == '{"x":1}'
    assert events[10][1]["content_block"]["name"] == "g" and events[10][1]["index"] == 2
    assert events[11][1]["delta"] == {"type": "input_json_delta", "partial_json": "{}"}
    assert [e[1]["index"] for e in events if e[0] == "content_block_stop"] == [0, 1, 2]
    delta = events[13][1]
    assert delta["delta"] == {"stop_reason": "tool_use", "stop_sequence": None}
    assert delta["usage"]["output_tokens"] == 9 and delta["usage"]["input_tokens"] == 11


def test_length_finish_and_missing_usage():
    events = _run(_sse_lines(_chunk({"content": "abcdefgh"}), _chunk({}, finish="length"), b"[DONE]"))
    delta = [d for n, d in events if n == "message_delta"][0]
    assert delta["delta"]["stop_reason"] == "max_tokens"
    assert delta["usage"] == {"output_tokens": 2}  # chars / 4 estimate
    assert events[-1][0] == "message_stop"


def test_tool_name_arriving_after_arguments_is_buffered():
    items = _sse_lines(
        _chunk({"tool_calls": [{"index": 0, "id": "c1", "function": {"arguments": '{"q"'}}]}),
        _chunk({"tool_calls": [{"index": 0, "function": {"name": "search", "arguments": ':"x"}'}}]}),
        _chunk({}, finish="stop"),
    )
    events = _run(items)
    starts = [d for n, d in events if n == "content_block_start"]
    assert starts[0]["content_block"]["name"] == "search"
    partial = "".join(d["delta"]["partial_json"] for n, d in events if n == "content_block_delta")
    assert json.loads(partial) == {"q": "x"}
    assert [d for n, d in events if n == "message_delta"][0]["delta"]["stop_reason"] == "tool_use"


def test_upstream_error_chunk_becomes_error_event():
    items = _sse_lines(
        _chunk({"content": "partial"}),
        {"error": {"message": "rate limited upstream", "type": "rate_limit_exceeded"}},
        _chunk({"content": "ignored"}),
    )
    events = _run(items)
    assert events[-1] == (
        "error",
        {"type": "error", "error": {"type": "rate_limit_error", "message": "rate limited upstream"}},
    )
    assert "message_stop" not in [n for n, _ in events]
    assert not any(n == "content_block_delta" and d["delta"].get("text") == "ignored" for n, d in events)


def test_raw_upstream_error_body_becomes_error_event():
    # ProxyHandler streams the raw body of a non-2xx upstream response line by line.
    items = [b'{"error": {"message": "invalid api key",\n', b'"code": "invalid_api_key"}}\n']
    events = _run(items)
    assert [n for n, _ in events] == ["message_start", "ping", "error"]
    assert events[-1][1]["error"] == {"type": "authentication_error", "message": "invalid api key"}


def test_transport_failure_mid_stream_becomes_error_event():
    closed = []

    class Source:
        def __aiter__(self):
            return self

        def __init__(self):
            self.n = 0

        async def __anext__(self):
            self.n += 1
            if self.n == 1:
                return b'data: {"choices":[{"delta":{"content":"a"}}]}\n'
            raise httpx.ReadError("reset")

        async def aclose(self):
            closed.append(True)

    conv = StreamConverter(model="m", message_id="msg_1")

    async def go():
        return [ev async for ev in convert_stream(Source(), conv)]

    events = _parse(b"".join(asyncio.run(go())))
    assert events[-1][0] == "error" and events[-1][1]["error"]["type"] == "api_error"
    assert closed == [True]


def test_split_utf8_and_crlf_lines():
    payload = json.dumps(_chunk({"content": "héllo"}), ensure_ascii=False).encode()
    raw = b"data: " + payload + b"\r\n\r\ndata: [DONE]\r\n"
    cut = raw.index("é".encode()) + 1
    items = [raw[:10], raw[10:cut], raw[cut:]]  # second cut splits the multi-byte character
    events = _run(items)
    texts = [d["delta"]["text"] for n, d in events if n == "content_block_delta"]
    assert texts == ["héllo"]
