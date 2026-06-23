"""Legacy MCP server aliases from the voidllm era."""

from __future__ import annotations

LEGACY_MCP_ALIASES = frozenset({"voidllm"})
RESERVED_MCP_ALIASES = frozenset({"wai", *LEGACY_MCP_ALIASES})


def is_legacy_mcp_alias(alias: str) -> bool:
    return alias.strip().lower() in LEGACY_MCP_ALIASES
