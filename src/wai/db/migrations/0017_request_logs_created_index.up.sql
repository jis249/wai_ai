-- Timestamp-only index on request_logs: system-admin (all orgs) dashboard KPIs filter
-- request_logs by created_at alone, which idx_request_logs_org_created (org_id first)
-- cannot serve.
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at
    ON request_logs (created_at DESC);
