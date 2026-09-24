"""Anthropic Messages API compatibility layer over the OpenAI-format proxy."""

from wai.proxy.anthropic.endpoint import handle_count_tokens, handle_messages, register_anthropic_routes
from wai.proxy.anthropic.stream import StreamConverter, convert_stream
from wai.proxy.anthropic.translate import (
    TranslationError,
    anthropic_to_openai,
    estimate_input_tokens,
    openai_to_anthropic,
)

__all__ = [
    "StreamConverter",
    "TranslationError",
    "anthropic_to_openai",
    "convert_stream",
    "estimate_input_tokens",
    "handle_count_tokens",
    "handle_messages",
    "openai_to_anthropic",
    "register_anthropic_routes",
]
