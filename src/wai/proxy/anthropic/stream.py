"""OpenAI chat-completion SSE -> Anthropic Messages SSE conversion."""

from __future__ import annotations

import codecs
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from wai.proxy.anthropic.translate import (
    anthropic_error,
    error_type_from_payload,
    extract_error,
    map_stop_reason,
    map_usage,
)

log = logging.getLogger("wai.proxy.anthropic")


def sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode()


class _ToolState:
    __slots__ = ("id", "name", "args", "block", "closed")

    def __init__(self) -> None:
        self.id = ""
        self.name = ""
        self.args: list[str] = []  # buffered until the block can be opened (name known)
        self.block: int | None = None
        self.closed = False


class StreamConverter:
    """Stateful converter: feed OpenAI SSE lines, get Anthropic SSE event bytes.

    Event order: message_start, ping, then per content block content_block_start /
    content_block_delta* / content_block_stop (text and every tool-call index are separate blocks,
    emitted sequentially), then message_delta and message_stop. An upstream error produces a single
    ``event: error`` and ends the stream.
    """

    def __init__(self, *, model: str, message_id: str, input_tokens_estimate: int = 0) -> None:
        self.model = model
        self.message_id = message_id
        self.input_tokens_estimate = input_tokens_estimate
        self._next_block = 0
        self._open: tuple[str, Any] | None = None  # ("text", None) | ("tool", key)
        self._tools: dict[Any, _ToolState] = {}
        self._finish_reason: Any = None
        self._usage: dict[str, Any] | None = None
        self._saw_data = False
        self._raw_error: list[str] = []
        self._out_chars = 0
        self._has_tool_use = False
        self.done = False  # after error or finish, input is ignored

    # -- lifecycle --------------------------------------------------------------------------------

    def start(self) -> list[bytes]:
        message = {
            "id": self.message_id,
            "type": "message",
            "role": "assistant",
            "model": self.model,
            "content": [],
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {
                # Estimate (chars / 4); the real count arrives in message_delta.usage.
                "input_tokens": self.input_tokens_estimate,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
        }
        return [sse("message_start", {"type": "message_start", "message": message}), sse("ping", {"type": "ping"})]

    def error(self, error_type: str, message: str) -> list[bytes]:
        if self.done:
            return []
        self.done = True
        return [sse("error", anthropic_error(error_type, message))]

    def finish(self) -> list[bytes]:
        if self.done:
            return []
        if self._raw_error and not self._saw_data:
            err, msg = extract_error("\n".join(self._raw_error))
            return self.error(error_type_from_payload(err), msg or "upstream error")
        out: list[bytes] = []
        # Tool calls whose name never arrived are still surfaced.
        for key, state in self._tools.items():
            if state.block is None:
                out.extend(self._open_tool(key, state))
        out.extend(self._close_open())
        self.done = True
        usage_out: dict[str, Any] = {}
        if self._usage is not None:
            mapped = map_usage(self._usage)
            usage_out = {
                "input_tokens": mapped["input_tokens"],
                "output_tokens": mapped["output_tokens"],
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": mapped["cache_read_input_tokens"],
            }
        else:
            usage_out = {"output_tokens": max(1, self._out_chars // 4) if self._out_chars else 0}
        out.append(
            sse(
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": map_stop_reason(self._finish_reason, self._has_tool_use),
                        "stop_sequence": None,
                    },
                    "usage": usage_out,
                },
            )
        )
        out.append(sse("message_stop", {"type": "message_stop"}))
        return out

    # -- input ------------------------------------------------------------------------------------

    def feed_line(self, line: str) -> list[bytes]:
        if self.done:
            return []
        line = line.rstrip("\r")
        if not line.strip() or line.startswith(":") or line.startswith("event:"):
            return []
        if not line.startswith("data:"):
            # Non-SSE text: the raw body of an upstream error response.
            if sum(len(x) for x in self._raw_error) < 4000:
                self._raw_error.append(line)
            return []
        payload = line[5:].strip()
        if payload == "[DONE]":
            return []
        try:
            chunk = json.loads(payload)
        except ValueError:
            return []
        if not isinstance(chunk, dict):
            return []
        if chunk.get("error") is not None:
            err, msg = extract_error(chunk)
            return self.error(error_type_from_payload(err), msg)
        self._saw_data = True
        return self._feed_chunk(chunk)

    def _feed_chunk(self, chunk: dict[str, Any]) -> list[bytes]:
        out: list[bytes] = []
        if isinstance(chunk.get("usage"), dict):
            self._usage = chunk["usage"]
        choices = chunk.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            return out
        choice = choices[0]
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}

        text = delta.get("content")
        if not text and isinstance(delta.get("refusal"), str):
            text = delta["refusal"]
        if isinstance(text, str) and text:
            if self._open is None or self._open[0] != "text":
                out.extend(self._close_open())
                out.append(self._block_start({"type": "text", "text": ""}))
                self._open = ("text", None)
            self._out_chars += len(text)
            out.append(self._delta({"type": "text_delta", "text": text}))

        tool_calls = delta.get("tool_calls")
        if isinstance(tool_calls, list):
            for pos, tc in enumerate(tool_calls):
                if isinstance(tc, dict):
                    out.extend(self._feed_tool(tc, pos))

        if choice.get("finish_reason"):
            self._finish_reason = choice["finish_reason"]
        return out

    def _feed_tool(self, tc: dict[str, Any], pos: int) -> list[bytes]:
        key = tc.get("index", pos)
        state = self._tools.get(key)
        if state is None:
            state = self._tools[key] = _ToolState()
        if tc.get("id") and not state.id:
            state.id = str(tc["id"])
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        if fn.get("name") and not state.name:
            state.name = str(fn["name"])
        args = fn.get("arguments")
        if isinstance(args, dict):
            args = json.dumps(args)
        out: list[bytes] = []
        if isinstance(args, str) and args:
            self._out_chars += len(args)
            if state.block is None:
                state.args.append(args)
            elif state.closed:
                log.warning("dropping tool-call argument delta for a closed content block")
            else:
                out.append(self._delta({"type": "input_json_delta", "partial_json": args}))
        if state.block is None and state.name:
            out.extend(self._open_tool(key, state))
        return out

    # -- blocks -----------------------------------------------------------------------------------

    def _open_tool(self, key: Any, state: _ToolState) -> list[bytes]:
        out = self._close_open()
        if not state.id:
            state.id = f"toolu_{uuid.uuid4().hex[:24]}"
        state.block = self._next_block
        self._has_tool_use = True
        out.append(self._block_start({"type": "tool_use", "id": state.id, "name": state.name, "input": {}}))
        self._open = ("tool", key)
        if state.args:
            out.append(self._delta({"type": "input_json_delta", "partial_json": "".join(state.args)}))
            state.args = []
        return out

    def _block_start(self, block: dict[str, Any]) -> bytes:
        index = self._next_block
        self._next_block += 1
        return sse("content_block_start", {"type": "content_block_start", "index": index, "content_block": block})

    def _delta(self, delta: dict[str, Any]) -> bytes:
        return sse(
            "content_block_delta",
            {"type": "content_block_delta", "index": self._next_block - 1, "delta": delta},
        )

    def _close_open(self) -> list[bytes]:
        if self._open is None:
            return []
        kind, key = self._open
        if kind == "tool":
            self._tools[key].closed = True
        self._open = None
        return [sse("content_block_stop", {"type": "content_block_stop", "index": self._next_block - 1})]


async def convert_stream(
    body_iterator: AsyncIterator[Any],
    converter: StreamConverter,
) -> AsyncIterator[bytes]:
    """Drive ``converter`` over an OpenAI SSE byte/str iterator, always closing the source."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    buffer = ""
    try:
        for ev in converter.start():
            yield ev
        try:
            async for chunk in body_iterator:
                buffer += decoder.decode(chunk) if isinstance(chunk, (bytes, bytearray)) else str(chunk)
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    for ev in converter.feed_line(line):
                        yield ev
                if converter.done:
                    break
            buffer += decoder.decode(b"", final=True)
            if buffer:
                for ev in converter.feed_line(buffer):
                    yield ev
        except Exception as exc:  # upstream transport failure mid-stream
            log.warning("anthropic stream: upstream error: %s", exc)
            for ev in converter.error("api_error", "upstream stream error"):
                yield ev
            return
        for ev in converter.finish():
            yield ev
    finally:
        aclose = getattr(body_iterator, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # pragma: no cover - best effort
                pass
