"""External MCP server proxy handlers."""

from __future__ import annotations

import asyncio

import json
import logging
import os
import time
from typing import Any

import httpx
from fastapi import Request
from fastapi.responses import Response

from wai.api.admin.common import KeyInfo, ROLE_SYSTEM_ADMIN, has_role, new_uuid, utc_now_iso
from wai.api.admin.handler import get_handler
from wai.mcp.client import build_auth_headers
from wai.security.url import validate_http_url

log = logging.getLogger("wai.mcp.proxy")

# Opt-in strict mode for the explicit-allow policy documented in migration 0004
# ("Empty table = NO access"). Default off: an org with no org_mcp_access rows
# keeps access to every global server, which is the historical behaviour.
EXPLICIT_ALLOW_ENV = "WAI_MCP_ACCESS_EXPLICIT_ALLOW"

# Client request headers that are relayed to the upstream MCP server.
_FORWARD_HEADERS = ("mcp-session-id", "mcp-protocol-version", "last-event-id")
_DEFAULT_ACCEPT = "application/json, text/event-stream"


def _jsonrpc_error(req_id: Any, code: int, message: str, status_code: int) -> Response:
    return Response(
        content=json.dumps({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}),
        status_code=status_code,
        media_type="application/json",
    )


def explicit_allow_enabled(h: Any) -> bool:
    """Whether an empty org_mcp_access list denies access to global servers."""
    val = getattr(h, "mcp_access_explicit_allow", None)
    if val is None:
        val = os.environ.get(EXPLICIT_ALLOW_ENV, "")
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


async def _access_ids(db, table: str, col: str, entity_id: str) -> set[str]:
    if not entity_id:
        return set()
    rows = await db.fetchall(f"SELECT server_id FROM {table} WHERE {col} = ?", (entity_id,))
    return {r["server_id"] for r in rows}


async def check_mcp_access(h: Any, server: dict[str, Any], key_info: KeyInfo) -> str | None:
    """Return a denial reason, or None when the key may use the server.

    Resolution follows migration 0004 (key -> team -> org):
      * org/team-owned servers are governed by their scope and skip these lists.
      * key_mcp_access / team_mcp_access: when non-empty, the (global) server must be listed.
      * org_mcp_access (global servers only, system admins exempt): when non-empty the
        server must be listed; when empty, access is allowed unless explicit-allow
        strict mode is enabled (WAI_MCP_ACCESS_EXPLICIT_ALLOW).
    """
    server_id = server["id"]
    if server.get("org_id") or server.get("team_id"):
        # Org/team-owned servers are governed by their scope; allowlists narrow global servers.
        return None

    key_ids = await _access_ids(h.db, "key_mcp_access", "key_id", key_info.id)
    if key_ids and server_id not in key_ids:
        return "access denied to MCP server for this key"

    team_ids = await _access_ids(h.db, "team_mcp_access", "team_id", key_info.team_id)
    if team_ids and server_id not in team_ids:
        return "access denied to MCP server for this team"

    if not has_role(key_info.role, ROLE_SYSTEM_ADMIN):
        org_ids = await _access_ids(h.db, "org_mcp_access", "org_id", key_info.org_id)
        if org_ids:
            if server_id not in org_ids:
                return "access denied to MCP server"
        elif explicit_allow_enabled(h):
            return "access denied to MCP server"
    return None


async def _blocked_tools(db, server_id: str) -> set[str]:
    rows = await db.fetchall(
        "SELECT tool_name FROM mcp_tool_blocklist WHERE server_id = ?", (server_id,)
    )
    return {r["tool_name"] for r in rows}


def _parse_jsonrpc(body: bytes) -> list[dict[str, Any]]:
    """Return JSON-RPC messages from a single or batch request body (empty if unparsable)."""
    try:
        doc = json.loads(body) if body else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        return []
    if isinstance(doc, dict):
        return [doc]
    if isinstance(doc, list):
        return [m for m in doc if isinstance(m, dict)]
    return []


def tool_call_names(messages: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for msg in messages:
        if msg.get("method") != "tools/call":
            continue
        params = msg.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        names.append(name if isinstance(name, str) else "")
    return names


def _filter_tools_doc(doc: Any, blocked: set[str]) -> bool:
    """Drop blocked tools from tools/list result(s) in place; returns True if changed."""
    changed = False
    docs = doc if isinstance(doc, list) else [doc]
    for d in docs:
        if not isinstance(d, dict):
            continue
        result = d.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("tools"), list):
            continue
        kept = [t for t in result["tools"] if not (isinstance(t, dict) and t.get("name") in blocked)]
        if len(kept) != len(result["tools"]):
            result["tools"] = kept
            changed = True
    return changed


def filter_tools_list_payload(content: bytes, blocked: set[str]) -> bytes:
    """Remove blocked tools from a tools/list response body (plain JSON or SSE)."""
    if not blocked or not content:
        return content
    try:
        text = content.decode()
    except UnicodeDecodeError:
        return content
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            doc = json.loads(text)
        except json.JSONDecodeError:
            return content
        return json.dumps(doc).encode() if _filter_tools_doc(doc, blocked) else content

    out_lines: list[str] = []
    changed = False
    for line in text.split("\n"):
        if line.startswith("data:"):
            payload = line[5:].strip()
            try:
                doc = json.loads(payload)
            except json.JSONDecodeError:
                doc = None
            if doc is not None and _filter_tools_doc(doc, blocked):
                line = f"data: {json.dumps(doc)}"
                changed = True
        out_lines.append(line)
    return "\n".join(out_lines).encode() if changed else content


async def _log_usage(
    h: Any, key_info: KeyInfo, alias: str, tool_names: list[str], duration_ms: int, status: str
) -> None:
    """Record one mcp_usage_events row per tools/call (or one row for other methods)."""
    try:
        now = utc_now_iso()
        for tool_name in tool_names or [""]:
            await h.db.execute(
                """INSERT INTO mcp_usage_events (id, org_id, team_id, user_id, key_id, server_alias,
                                                   tool_name, duration_ms, status, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_uuid(), key_info.org_id, key_info.team_id or None, key_info.user_id or None,
                    key_info.id, alias, tool_name, duration_ms, status, now,
                ),
            )
        await h.db.commit()
    except Exception as exc:
        log.warning("failed to record MCP usage for server %s: %s", alias, exc)


async def handle_mcp_proxy(alias: str, request: Request, key_info: KeyInfo) -> Response:
    h = get_handler()

    if alias == "wai":
        from wai.api.admin.mcp_handler import _handle_mcp_request

        return await _handle_mcp_request(request, h.mcp_server, "wai", "/api/v1/mcp/wai")

    row = await h.db.fetchone(
        """SELECT * FROM mcp_servers WHERE alias = ? AND is_active = 1 AND deleted_at IS NULL
           AND (org_id IS NULL OR org_id = ?)
           AND (team_id IS NULL OR team_id = ?
                OR (? = '' AND team_id IN (SELECT team_id FROM team_memberships WHERE user_id = ?)))
           ORDER BY CASE WHEN team_id IS NOT NULL THEN 0 WHEN org_id IS NOT NULL THEN 1 ELSE 2 END
           LIMIT 1""",
        (alias, key_info.org_id, key_info.team_id, key_info.team_id, key_info.user_id or ""),
    )
    if not row:
        return _jsonrpc_error(None, -32600, "unknown MCP server", 404)
    server = dict(row)
    try:
        # URLs are DNS-checked when servers are created/updated; don't re-resolve on every call.
        validate_http_url(server["url"], allow_private=h.mcp_allow_private_urls, resolve=False)
    except ValueError:
        return _jsonrpc_error(None, -32600, "invalid MCP server URL", 403)

    denial = await check_mcp_access(h, server, key_info)
    if denial:
        return _jsonrpc_error(None, -32600, denial, 403)

    body = await request.body()
    messages = _parse_jsonrpc(body)
    tool_names = tool_call_names(messages)
    wants_tools_list = any(m.get("method") == "tools/list" for m in messages)
    blocked: set[str] = set()
    if tool_names or wants_tools_list:
        blocked = await _blocked_tools(h.db, server["id"])
    for msg in messages:
        if msg.get("method") != "tools/call":
            continue
        params = msg.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        if name in blocked:
            return _jsonrpc_error(msg.get("id"), -32601, f"tool is blocked: {name}", 403)

    start = time.time()
    try:
        client = h._mcp_client
        if client is None:
            client = httpx.AsyncClient(timeout=h.mcp_call_timeout)
            h._mcp_client = client
        headers = {
            "Content-Type": "application/json",
            "Accept": request.headers.get("accept") or _DEFAULT_ACCEPT,
        }
        for hname in _FORWARD_HEADERS:
            if request.headers.get(hname):
                headers[hname.title()] = request.headers[hname]
        # Server credentials are applied last so client headers cannot override them.
        headers.update(build_auth_headers(server, h.encryption_key))
        upstream = await client.post(server["url"], content=body, headers=headers)
    except Exception as exc:
        duration_ms = int((time.time() - start) * 1000)
        status = "timeout" if isinstance(exc, httpx.TimeoutException) else "error"
        log.warning("upstream MCP server %s request failed: %s", alias, exc)
        await _log_usage(h, key_info, alias, tool_names, duration_ms, status)
        return _jsonrpc_error(None, -32603, "upstream MCP server error", 500)

    duration_ms = int((time.time() - start) * 1000)
    await _log_usage(
        h, key_info, alias, tool_names, duration_ms,
        "success" if upstream.status_code < 400 else "error",
    )

    content = upstream.content
    if wants_tools_list and blocked:
        content = filter_tools_list_payload(content, blocked)

    resp_headers: dict[str, str] = {}
    session_id = upstream.headers.get("mcp-session-id")
    if session_id:
        resp_headers["Mcp-Session-Id"] = session_id

    upstream_type = upstream.headers.get("content-type", "").split(";")[0].strip()
    if upstream_type in ("application/json", "text/event-stream"):
        media_type = upstream_type
    elif "text/event-stream" in request.headers.get("accept", ""):
        media_type = "text/event-stream"
    else:
        media_type = "application/json"
    return Response(
        content=content, media_type=media_type, status_code=upstream.status_code, headers=resp_headers
    )
