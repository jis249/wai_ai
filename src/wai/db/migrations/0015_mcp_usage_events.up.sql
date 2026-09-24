-- Migration: 0015_mcp_usage_events.up.sql
-- Description: Append-only log of requests proxied through the external MCP
-- gateway (/api/v1/mcp/{alias}). Written by api/admin/mcp_proxy.py and read by
-- api/admin/mcp_usage.py. One row per tools/call message (tool_name set), or one
-- row with tool_name = '' for other JSON-RPC methods (initialize, tools/list, ...).
-- Fully denormalized like usage_events / mcp_tool_calls: no foreign keys.
-- status: 'success' | 'error' | 'timeout'
-- timestamp: UTC ISO 8601 text (YYYY-MM-DDTHH:MM:SS+00:00), set by the writer.

CREATE TABLE IF NOT EXISTS mcp_usage_events (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL DEFAULT '',
    team_id       TEXT,
    user_id       TEXT,
    key_id        TEXT NOT NULL DEFAULT '',
    server_alias  TEXT NOT NULL,
    tool_name     TEXT NOT NULL DEFAULT '',
    duration_ms   INTEGER,
    status        TEXT NOT NULL DEFAULT 'success',
    timestamp     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Query patterns from mcp_usage.py: time range filtered by org / team / user,
-- plus system-wide (time only) and per-server breakdowns.
CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_org_time
    ON mcp_usage_events (org_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_team_time
    ON mcp_usage_events (team_id, timestamp) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_user_time
    ON mcp_usage_events (user_id, timestamp) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_server_time
    ON mcp_usage_events (server_alias, timestamp);
CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_timestamp
    ON mcp_usage_events (timestamp);
