"""Database access for alert channels, rules and events.

SQL uses ``?`` placeholders (rewritten to ``$n`` for PostgreSQL) and stays portable so the
tests can run against an in-memory SQLite facade.
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any

from wai.alerts.models import (
    ORG_RULE_KINDS,
    RULE_KINDS,
    AlertChannel,
    AlertEvent,
    AlertRule,
    iso,
    utc_now,
)
from wai.crypto.aes import decrypt_string, encrypt_string

log = logging.getLogger("wai.alerts")


def url_aad(channel_id: str) -> bytes:
    return f"alert_channel:{channel_id}".encode()


def secret_aad(channel_id: str) -> bytes:
    return f"alert_channel_secret:{channel_id}".encode()


def new_signing_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


def rule_kinds_for(org_id: str | None) -> tuple[str, ...]:
    return ORG_RULE_KINDS if org_id else RULE_KINDS


def _scope_clause(org_id: str | None, col: str = "org_id") -> tuple[str, tuple]:
    if org_id:
        return f"{col} = ?", (org_id,)
    return f"{col} IS NULL", ()


class AlertStore:
    def __init__(self, db: Any, encryption_key: bytes) -> None:
        self.db = db
        self._key = encryption_key[:32]

    # --- channels ---------------------------------------------------------------------

    def encrypt_url(self, channel_id: str, url: str) -> str:
        return encrypt_string(url, self._key, url_aad(channel_id))

    def encrypt_secret(self, channel_id: str, secret: str) -> str:
        return encrypt_string(secret, self._key, secret_aad(channel_id)) if secret else ""

    def _decrypt_channel(self, row: dict[str, Any]) -> AlertChannel | None:
        cid = row["id"]
        try:
            url = decrypt_string(row["url_enc"], self._key, url_aad(cid))
            secret = decrypt_string(row["secret_enc"], self._key, secret_aad(cid)) if row.get("secret_enc") else ""
        except Exception:
            log.warning("alert channel %s could not be decrypted", cid)
            return None
        return AlertChannel(
            id=cid,
            org_id=row.get("org_id") or None,
            name=row.get("name") or "",
            kind=row.get("kind") or "webhook",
            url=url,
            secret=secret,
            enabled=bool(row.get("enabled")),
        )

    async def list_channel_rows(self, org_id: str | None) -> list[dict[str, Any]]:
        where, params = _scope_clause(org_id)
        rows = await self.db.fetchall(
            f"SELECT * FROM alert_channels WHERE {where} ORDER BY created_at, id", params
        )
        return [dict(r) for r in rows]

    async def get_channel_row(self, channel_id: str) -> dict[str, Any] | None:
        row = await self.db.fetchone("SELECT * FROM alert_channels WHERE id = ?", (channel_id,))
        return dict(row) if row else None

    async def get_channel(self, channel_id: str) -> AlertChannel | None:
        row = await self.get_channel_row(channel_id)
        return self._decrypt_channel(row) if row else None

    async def enabled_channels(self, org_id: str | None) -> list[AlertChannel]:
        where, params = _scope_clause(org_id)
        rows = await self.db.fetchall(
            f"SELECT * FROM alert_channels WHERE {where} AND enabled = 1 ORDER BY created_at, id", params
        )
        out = []
        for r in rows:
            ch = self._decrypt_channel(dict(r))
            if ch is not None:
                out.append(ch)
        return out

    async def insert_channel(
        self, *, channel_id: str, org_id: str | None, name: str, kind: str, url: str, url_hint: str,
        secret: str, enabled: bool, created_by: str,
    ) -> None:
        now = iso(utc_now())
        await self.db.execute(
            """INSERT INTO alert_channels (id, org_id, name, kind, url_enc, url_hint, secret_enc, enabled,
                   created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                channel_id, org_id, name, kind, self.encrypt_url(channel_id, url), url_hint,
                self.encrypt_secret(channel_id, secret), int(enabled), created_by, now, now,
            ),
        )
        await self.db.commit()

    async def update_channel(self, channel_id: str, fields: dict[str, Any]) -> None:
        if not fields:
            return
        cols = []
        vals: list[Any] = []
        for k, v in fields.items():
            cols.append(f"{k} = ?")
            vals.append(v)
        cols.append("updated_at = ?")
        vals.append(iso(utc_now()))
        vals.append(channel_id)
        await self.db.execute(f"UPDATE alert_channels SET {', '.join(cols)} WHERE id = ?", tuple(vals))
        await self.db.commit()

    async def delete_channel(self, channel_id: str, org_id: str | None = None) -> int:
        cur = await self.db.execute("DELETE FROM alert_channels WHERE id = ?", (channel_id,))
        # Drop the id from rule targets so a rule never ends up pointing only at deleted channels.
        for row in await self.rule_rows(org_id):
            rule = AlertRule.from_row(row)
            if channel_id in rule.channel_ids:
                rule.channel_ids = [c for c in rule.channel_ids if c != channel_id]
                await self.update_rule(rule)
        await self.db.commit()
        return int(getattr(cur, "rowcount", 0) or 0)

    # --- rules ------------------------------------------------------------------------

    async def rule_rows(self, org_id: str | None) -> list[dict[str, Any]]:
        where, params = _scope_clause(org_id)
        rows = await self.db.fetchall(f"SELECT * FROM alert_rules WHERE {where}", params)
        return [dict(r) for r in rows]

    async def all_rules(self) -> list[AlertRule]:
        rows = await self.db.fetchall("SELECT * FROM alert_rules", ())
        return [AlertRule.from_row(dict(r)) for r in rows]

    async def effective_rule(self, org_id: str | None, kind: str) -> AlertRule:
        where, params = _scope_clause(org_id)
        row = await self.db.fetchone(f"SELECT * FROM alert_rules WHERE {where} AND kind = ?", (*params, kind))
        return AlertRule.from_row(dict(row)) if row else AlertRule.default(kind, org_id)

    async def seed_rules(self, org_id: str | None, new_id) -> list[AlertRule]:
        """Insert default rules missing for the scope; return all rules for the scope in kind order."""
        existing = {r["kind"]: r for r in await self.rule_rows(org_id)}
        now = iso(utc_now())
        for kind in rule_kinds_for(org_id):
            if kind in existing:
                continue
            d = AlertRule.default(kind, org_id)
            await self.db.execute(
                """INSERT INTO alert_rules (id, org_id, kind, enabled, severity_min, cooldown_seconds, params,
                       channel_ids, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                (new_id(), org_id, kind, int(d.enabled), d.severity_min, d.cooldown_seconds,
                 json.dumps(d.params), "[]", now, now),
            )
        await self.db.commit()
        rows = {r["kind"]: r for r in await self.rule_rows(org_id)}
        return [AlertRule.from_row(rows[k]) if k in rows else AlertRule.default(k, org_id) for k in rule_kinds_for(org_id)]

    async def update_rule(self, rule: AlertRule) -> None:
        where, params = _scope_clause(rule.org_id)
        await self.db.execute(
            f"""UPDATE alert_rules SET enabled = ?, severity_min = ?, cooldown_seconds = ?, params = ?,
                    channel_ids = ?, updated_at = ?
                WHERE {where} AND kind = ?""",
            (int(rule.enabled), rule.severity_min, int(rule.cooldown_seconds), json.dumps(rule.params),
             json.dumps(rule.channel_ids), iso(utc_now()), *params, rule.kind),
        )
        await self.db.commit()

    # --- events -----------------------------------------------------------------------

    async def record_event(self, event: AlertEvent, delivered: dict[str, Any]) -> None:
        await self.db.execute(
            """INSERT INTO alert_events (id, org_id, kind, severity, title, message, data, dedupe_key,
                   delivered, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.id, event.org_id, event.kind, event.severity, event.title, event.message,
                json.dumps(event.data, default=str), event.dedupe_key or "", json.dumps(delivered), event.created_at,
            ),
        )
        await self.db.commit()

    async def last_event_time(self, kind: str, dedupe_key: str, org_id: str | None) -> str | None:
        where, params = _scope_clause(org_id)
        row = await self.db.fetchone(
            f"""SELECT created_at FROM alert_events WHERE dedupe_key = ? AND kind = ? AND {where}
                ORDER BY created_at DESC LIMIT 1""",
            (dedupe_key, kind, *params),
        )
        return row["created_at"] if row else None

    async def dedupe_key_exists(self, dedupe_key: str) -> bool:
        row = await self.db.fetchone("SELECT id FROM alert_events WHERE dedupe_key = ? LIMIT 1", (dedupe_key,))
        return row is not None

    async def list_events(
        self, *, org_id: str | None, all_scopes: bool, kind: str = "", severity: str = "",
        cursor: str = "", limit: int = 50,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if not all_scopes:
            where, p = _scope_clause(org_id)
            clauses.append(where)
            params.extend(p)
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        if severity:
            clauses.append("severity = ?")
            params.append(severity)
        if cursor:
            clauses.append("id < ?")
            params.append(cursor)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(limit))
        rows = await self.db.fetchall(
            f"SELECT * FROM alert_events {where_sql} ORDER BY id DESC LIMIT ?", tuple(params)
        )
        return [dict(r) for r in rows]

    async def purge_events(self, before_iso: str) -> int:
        cur = await self.db.execute("DELETE FROM alert_events WHERE created_at < ?", (before_iso,))
        await self.db.commit()
        return int(getattr(cur, "rowcount", 0) or 0)
