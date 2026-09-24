-- Alerting: notification channels, per-scope rules and the delivered-event log.
-- org_id NULL = platform scope (managed by system admins).

CREATE TABLE IF NOT EXISTS alert_channels (
    id          TEXT PRIMARY KEY,
    org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('teams', 'slack', 'webhook')),
    url_enc     TEXT NOT NULL,
    url_hint    TEXT NOT NULL DEFAULT '',
    secret_enc  TEXT NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_channels_org ON alert_channels (org_id);

CREATE TABLE IF NOT EXISTS alert_rules (
    id                TEXT PRIMARY KEY,
    org_id            TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1,
    severity_min      TEXT NOT NULL DEFAULT 'warning' CHECK (severity_min IN ('info', 'warning', 'critical')),
    cooldown_seconds  INTEGER NOT NULL DEFAULT 3600,
    params            TEXT NOT NULL DEFAULT '{}',
    channel_ids       TEXT NOT NULL DEFAULT '[]',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- One rule per (scope, kind); COALESCE folds the platform scope (NULL) into ''.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_scope_kind ON alert_rules ((COALESCE(org_id, '')), kind);

CREATE TABLE IF NOT EXISTS alert_events (
    id          TEXT PRIMARY KEY,
    org_id      TEXT,
    kind        TEXT NOT NULL,
    severity    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL DEFAULT '{}',
    dedupe_key  TEXT NOT NULL DEFAULT '',
    delivered   TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);

-- Retention purge (created_at < cutoff).
CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events (created_at);
-- Per-scope listing, newest first (ids are UUIDv7, so id order is time order).
CREATE INDEX IF NOT EXISTS idx_alert_events_org_id ON alert_events (org_id, id DESC);
-- Cooldown / once-per-period lookups.
CREATE INDEX IF NOT EXISTS idx_alert_events_dedupe ON alert_events (dedupe_key, created_at DESC);
