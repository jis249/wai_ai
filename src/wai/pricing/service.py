"""Pricing sync: preview, apply, status, and the optional background auto-sync.

Rules:
- A model with ``pricing_source='manual'`` (the default) is never changed by the auto-sync.
  Its row shows ``manual_locked`` when the catalog price differs; the admin may still apply
  that row explicitly from the preview.
- ``pricing_source='synced'`` models are kept up to date by the auto-sync (when enabled).
- A model without a catalog match (or whose catalog entry has no price, typical for local
  models) is left untouched.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from wai.pricing.catalog import Catalog, CatalogError, CatalogFetcher, utc_now_iso
from wai.pricing.matcher import ModelFacts, match_model

logger = logging.getLogger("wai.pricing")

STATUS_KEY = "pricing_sync_status"
PRICING_SOURCES = ("manual", "synced")
ACTIONS = ("update", "unchanged", "no_match", "manual_locked")
# pg advisory lock key for the background sync ("WAIPRICE" folded into a signed bigint).
ADVISORY_LOCK_KEY = 0x5741_4950_5249_4345 & 0x7FFF_FFFF_FFFF_FFFF
_EPS = 1e-9


def _f(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= _EPS * max(1.0, abs(a), abs(b))


@dataclass
class PreviewRow:
    model_id: str
    name: str
    provider: str
    model_source: str
    pricing_source: str
    pricing_key: str
    pricing_synced_at: str
    current_input_per_1m: float
    current_output_per_1m: float
    current_context_window: int
    match_key: str = ""
    matched_via: str = ""
    catalog_input_per_1m: float | None = None
    catalog_output_per_1m: float | None = None
    catalog_context_window: int = 0
    input_diff: float = 0.0
    output_diff: float = 0.0
    action: str = "no_match"
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_row(row: dict[str, Any], deployments: list[dict[str, Any]], catalog: Catalog) -> PreviewRow:
    facts = ModelFacts.from_row(row, deployments)
    pricing_source = str(row.get("pricing_source") or "manual")
    if pricing_source not in PRICING_SOURCES:
        pricing_source = "manual"
    cur_in = _f(row.get("input_price_per_1m"))
    cur_out = _f(row.get("output_price_per_1m"))
    out = PreviewRow(
        model_id=facts.id,
        name=facts.name,
        provider=facts.provider,
        model_source=str(row.get("source") or "api"),
        pricing_source=pricing_source,
        pricing_key=facts.pricing_key,
        pricing_synced_at=str(row.get("pricing_synced_at") or ""),
        current_input_per_1m=cur_in,
        current_output_per_1m=cur_out,
        current_context_window=int(row.get("max_context_tokens") or 0),
    )
    match = match_model(facts, catalog)
    if match is None:
        out.note = (
            f"pricing_key {facts.pricing_key!r} is not in the catalog"
            if facts.pricing_key
            else "no catalog entry for this model"
        )
        return out
    entry = match.entry
    out.match_key = match.key
    out.matched_via = match.via
    out.catalog_context_window = entry.context_window
    if not entry.has_price:
        out.note = "catalog lists no price for this model"
        return out
    new_in = _f(entry.input_per_1m)
    new_out = _f(entry.output_per_1m)
    out.catalog_input_per_1m = new_in
    out.catalog_output_per_1m = new_out
    out.input_diff = round(new_in - cur_in, 6)
    out.output_diff = round(new_out - cur_out, 6)
    if _same(new_in, cur_in) and _same(new_out, cur_out):
        out.action = "unchanged"
    elif pricing_source == "synced" or (cur_in == 0 and cur_out == 0):
        # Nothing to overwrite when no price is configured yet.
        out.action = "update"
    else:
        out.action = "manual_locked"
    if out.model_source == "yaml":
        out.note = "defined in wai.yaml: prices revert to the YAML values on restart"
    return out


async def _load_models(db) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    rows = [dict(r) for r in await db.fetchall(
        "SELECT * FROM models WHERE deleted_at IS NULL ORDER BY name"
    )]
    deps: dict[str, list[dict[str, Any]]] = {}
    try:
        dep_rows = await db.fetchall(
            """SELECT model_id, name, provider, azure_deployment FROM model_deployments
               WHERE deleted_at IS NULL"""
        )
    except Exception:  # table missing in minimal/test schemas
        dep_rows = []
    for d in dep_rows:
        deps.setdefault(d["model_id"], []).append(dict(d))
    return rows, deps


async def build_preview(db, catalog: Catalog) -> list[PreviewRow]:
    rows, deps = await _load_models(db)
    return [build_row(r, deps.get(r["id"], []), catalog) for r in rows]


def count_actions(rows: list[PreviewRow]) -> dict[str, int]:
    counts = {a: 0 for a in ACTIONS}
    for r in rows:
        counts[r.action] = counts.get(r.action, 0) + 1
    return counts


@dataclass
class ApplyResult:
    updated: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"updated": self.updated, "skipped": self.skipped}


async def apply_rows(
    db,
    catalog: Catalog,
    model_ids: list[str],
    *,
    lock_to_synced: bool = False,
    only_synced: bool = False,
) -> ApplyResult:
    """Write catalog prices to the selected models.

    Explicit selection is the admin's consent, so ``manual_locked`` rows are applied too.
    ``only_synced`` (auto-sync) restricts writes to ``pricing_source='synced'`` models.
    ``no_match`` rows are always skipped. With ``lock_to_synced`` the applied models switch to
    ``pricing_source='synced'`` so later syncs keep them current.
    """
    wanted = list(dict.fromkeys(model_ids))
    preview = {r.model_id: r for r in await build_preview(db, catalog)}
    result = ApplyResult()
    now = utc_now_iso()
    for mid in wanted:
        row = preview.get(mid)
        if row is None:
            result.skipped.append({"model_id": mid, "reason": "model not found"})
            continue
        if only_synced and row.pricing_source != "synced":
            result.skipped.append({"model_id": mid, "name": row.name, "reason": "manual pricing"})
            continue
        if row.action == "no_match":
            result.skipped.append({"model_id": mid, "name": row.name, "reason": row.note or "no match"})
            continue
        new_source = "synced" if lock_to_synced else row.pricing_source
        if row.action == "unchanged":
            if new_source != row.pricing_source:
                await db.execute(
                    """UPDATE models SET pricing_source = ?, pricing_synced_at = ?,
                              updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (new_source, now, mid),
                )
                result.updated.append(_change(row, new_source, prices_changed=False))
            else:
                result.skipped.append({"model_id": mid, "name": row.name, "reason": "unchanged"})
            continue
        ctx = row.current_context_window or row.catalog_context_window
        await db.execute(
            """UPDATE models SET input_price_per_1m = ?, output_price_per_1m = ?,
                      max_context_tokens = ?, pricing_source = ?, pricing_synced_at = ?,
                      updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND deleted_at IS NULL""",
            (row.catalog_input_per_1m, row.catalog_output_per_1m, ctx, new_source, now, mid),
        )
        result.updated.append(_change(row, new_source, prices_changed=True))
    if result.updated:
        await db.commit()
    return result


def _change(row: PreviewRow, new_source: str, *, prices_changed: bool) -> dict[str, Any]:
    return {
        "model_id": row.model_id,
        "name": row.name,
        "match_key": row.match_key,
        "old_input_per_1m": row.current_input_per_1m,
        "old_output_per_1m": row.current_output_per_1m,
        "new_input_per_1m": row.catalog_input_per_1m if prices_changed else row.current_input_per_1m,
        "new_output_per_1m": row.catalog_output_per_1m if prices_changed else row.current_output_per_1m,
        "pricing_source": new_source,
        "prices_changed": prices_changed,
    }


async def set_pricing_settings(db, model_id: str, *, pricing_source: str | None, pricing_key: str | None) -> bool:
    fields: dict[str, Any] = {}
    if pricing_source is not None:
        fields["pricing_source"] = pricing_source
    if pricing_key is not None:
        fields["pricing_key"] = pricing_key.strip()
    if not fields:
        return True
    sets = ", ".join(f"{k} = ?" for k in fields)
    cur = await db.execute(
        f"UPDATE models SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        (*fields.values(), model_id),
    )
    await db.commit()
    return getattr(cur, "rowcount", 1) != 0


# --------------------------------------------------------------------------- status


async def read_status(db) -> dict[str, Any]:
    try:
        row = await db.fetchone("SELECT value FROM settings WHERE key = ?", (STATUS_KEY,))
    except Exception:
        return {}
    if not row:
        return {}
    try:
        data = json.loads(row["value"] or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def update_status(db, **changes: Any) -> dict[str, Any]:
    status = await read_status(db)
    status.update(changes)
    try:
        await db.execute(
            """INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (STATUS_KEY, json.dumps(status, separators=(",", ":")), utc_now_iso()),
        )
        await db.commit()
    except Exception as exc:  # status is best-effort; never fail the caller
        logger.warning("pricing status write failed: %s", exc)
    return status


async def record_fetch_error(db, source: str, error: str) -> None:
    await update_status(db, last_error=error[:500], last_error_at=utc_now_iso(), source=source)
    try:
        from wai.alerts import emit_alert

        emit_alert(
            "pricing.sync",
            "warning",
            "Model pricing sync failed",
            f"Could not refresh the model price list; existing prices were kept. {error[:300]}",
            data={"source": source},
            dedupe_key="pricing.sync.failed",
        )
    except Exception:
        pass


async def record_fetch_ok(db, catalog: Catalog) -> None:
    await update_status(
        db,
        source=catalog.source,
        last_fetch_at=catalog.fetched_at,
        entries=len(catalog),
        skipped_entries=catalog.skipped,
        etag=catalog.etag,
        last_error="",
    )


async def fetch_catalog(db, fetcher: CatalogFetcher, *, refresh: bool = False) -> Catalog:
    """Fetch via ``fetcher`` and record the outcome in the status row."""
    previous = fetcher.cached
    try:
        catalog = await fetcher.get(refresh=refresh)
    except CatalogError as exc:
        await record_fetch_error(db, fetcher.source, str(exc))
        raise
    if catalog is not previous:
        await record_fetch_ok(db, catalog)
    return catalog


# --------------------------------------------------------------------------- registry


async def reload_registries(h, app: Any = None) -> None:
    """Make new prices visible to cost calculation right away.

    Reloads the proxy registry (``load_db_into_registry``, which is what prices requests)
    and the admin model registry. Falls back to the handler's ``reload_models`` hook when
    the app's proxy registry is not reachable.
    """
    from wai.api.admin.models import reload_admin_model_registry

    registry = getattr(getattr(app, "state", None), "registry", None) if app is not None else None
    if registry is not None:
        from wai.proxy.registry import load_db_into_registry

        await load_db_into_registry(h.db, registry, h.encryption_key, logger)
        await reload_admin_model_registry(h)
        return
    hook = getattr(h, "reload_models", None)
    if hook is not None:
        await hook()
    else:
        await reload_admin_model_registry(h)


def audit_changes(h, changes: list[dict[str, Any]], *, actor: Any = None, action: str = "pricing.apply") -> None:
    audit = getattr(h, "audit_logger", None)
    if audit is None or not changes:
        return
    from wai.audit.logger import AuditEvent

    org_id = getattr(actor, "org_id", "") or ""
    actor_id = getattr(actor, "user_id", "") or ""
    for ch in changes:
        desc = (
            f"pricing {ch['name']}: in {ch['old_input_per_1m']} -> {ch['new_input_per_1m']}, "
            f"out {ch['old_output_per_1m']} -> {ch['new_output_per_1m']} per 1M "
            f"(catalog {ch['match_key']}, source {ch['pricing_source']})"
        )
        try:
            audit.log(AuditEvent(
                org_id=org_id,
                actor_id=actor_id,
                actor_type="user" if actor_id else "system",
                actor_key_id=getattr(actor, "id", "") or "",
                action=action,
                resource_type="models",
                resource_id=ch["model_id"],
                description=desc,
                status_code=200,
            ))
        except Exception as exc:
            logger.warning("pricing audit log failed: %s", exc)


# --------------------------------------------------------------------------- auto-sync


@asynccontextmanager
async def advisory_lock(db, key: int = ADVISORY_LOCK_KEY) -> AsyncIterator[bool]:
    """Session-level pg advisory lock on a dedicated pool connection. Yields whether it was won."""
    pool = getattr(db, "_pg_pool", None)
    if pool is None:
        yield True
        return
    async with pool.acquire() as conn:
        got = bool(await conn.fetchval("SELECT pg_try_advisory_lock($1)", key))
        try:
            yield got
        finally:
            if got:
                try:
                    await conn.execute("SELECT pg_advisory_unlock($1)", key)
                except Exception as exc:
                    logger.warning("pricing advisory unlock failed: %s", exc)


def _parse_ts(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S+00:00").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def run_auto_sync_once(h, fetcher: CatalogFetcher, *, app: Any = None,
                             min_interval: timedelta | None = None) -> dict[str, Any]:
    """One auto-sync pass: only ``pricing_source='synced'`` models, under the advisory lock.

    With ``min_interval`` a pass is skipped when another instance synced more recently.
    On failure the old prices stay and the error is recorded in the status row.
    """
    db = h.db
    async with advisory_lock(db) as got:
        if not got:
            return {"skipped": "another instance holds the pricing sync lock"}
        if min_interval is not None:
            last = _parse_ts((await read_status(db)).get("last_auto_sync_at", ""))
            if last is not None and datetime.now(timezone.utc) - last < min_interval:
                return {"skipped": "synced recently"}
        try:
            catalog = await fetch_catalog(db, fetcher, refresh=True)
        except CatalogError as exc:
            return {"error": str(exc)}
        try:
            preview = await build_preview(db, catalog)
            ids = [r.model_id for r in preview if r.pricing_source == "synced" and r.action == "update"]
            result = await apply_rows(db, catalog, ids, only_synced=True)
            if result.updated:
                await reload_registries(h, app)
                audit_changes(h, result.updated, action="pricing.auto_sync")
            now = utc_now_iso()
            await update_status(
                db,
                last_auto_sync_at=now,
                last_sync_at=now,
                counts=count_actions(preview),
                last_applied=len(result.updated),
            )
            return result.to_dict()
        except Exception as exc:
            logger.exception("pricing auto-sync failed")
            await record_fetch_error(db, fetcher.source, f"auto-sync failed: {exc}")
            return {"error": str(exc)}


async def auto_sync_loop(h, fetcher: CatalogFetcher, interval_hours: float, *, app: Any = None,
                         initial_delay: float = 60.0) -> None:
    interval = max(float(interval_hours or 24.0), 1.0) * 3600
    min_interval = timedelta(seconds=interval * 0.9)
    await asyncio.sleep(initial_delay)
    while True:
        try:
            await run_auto_sync_once(h, fetcher, app=app, min_interval=min_interval)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("pricing auto-sync pass crashed")
        await asyncio.sleep(interval)
