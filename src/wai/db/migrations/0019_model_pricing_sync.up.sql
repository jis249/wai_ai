-- Migration: 0019_model_pricing_sync.up.sql
-- Description: Model catalog pricing sync (LiteLLM community price list).
--
-- pricing_source:    'manual' (default) = prices are admin-owned and never changed by the
--                    automatic sync; 'synced' = the auto-sync may keep them up to date.
-- pricing_key:       optional manual catalog key override (e.g. 'azure/gpt-4o-mini').
--                    Empty = match automatically on name / provider / deployment.
-- pricing_synced_at: when prices were last written from the catalog (TEXT timestamp,
--                    '%Y-%m-%dT%H:%M:%S+00:00'); empty = never.
--
-- No context_window column: models.max_context_tokens (0001) already holds it.
-- The whole file runs inside one transaction (Database.executescript).

ALTER TABLE models ADD COLUMN IF NOT EXISTS pricing_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE models ADD COLUMN IF NOT EXISTS pricing_key TEXT NOT NULL DEFAULT '';
ALTER TABLE models ADD COLUMN IF NOT EXISTS pricing_synced_at TEXT NOT NULL DEFAULT '';

-- Last sync status (JSON document), read by GET /api/v1/pricing/status.
INSERT INTO settings (key, value) VALUES ('pricing_sync_status', '{}')
    ON CONFLICT (key) DO NOTHING;
