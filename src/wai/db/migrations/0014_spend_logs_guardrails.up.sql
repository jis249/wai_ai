ALTER TABLE organizations ADD COLUMN IF NOT EXISTS monthly_spend_limit DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS monthly_spend_limit DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS monthly_spend_limit DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS guardrail_pii INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS guardrail_tool_denylist TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS request_logs (
    id                  TEXT PRIMARY KEY,
    created_at          TEXT NOT NULL,
    org_id              TEXT NOT NULL,
    key_id              TEXT,
    model_name          TEXT NOT NULL DEFAULT '',
    requested_model     TEXT NOT NULL DEFAULT '',
    status_code         INTEGER NOT NULL DEFAULT 0,
    prompt_tokens       INTEGER NOT NULL DEFAULT 0,
    completion_tokens   INTEGER NOT NULL DEFAULT 0,
    cost_usd            DOUBLE PRECISION NOT NULL DEFAULT 0,
    latency_ms          INTEGER NOT NULL DEFAULT 0,
    cache_hit           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_request_logs_org_created
    ON request_logs (org_id, created_at DESC);
