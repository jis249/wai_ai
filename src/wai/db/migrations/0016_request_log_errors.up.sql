-- Store a trimmed upstream/proxy error message for failed requests.
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_request_logs_org_status_created
    ON request_logs (org_id, status_code, created_at DESC);
