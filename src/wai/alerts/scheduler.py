"""Built-in scheduled alert checks: budget thresholds, error rate, daily digest, retention.

Runs every ``interval`` seconds (default 300) with jitter. Only one gateway instance runs a
cycle at a time: the cycle holds a PostgreSQL session advisory lock
(``pg_try_advisory_lock``) on a dedicated pool connection; instances that fail to get it
skip the cycle.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Callable

from wai.alerts.models import (
    KIND_BUDGET,
    KIND_DIGEST,
    KIND_ERROR_RATE,
    AlertRule,
    iso,
    utc_now,
)

log = logging.getLogger("wai.alerts")

ADVISORY_LOCK_KEY = 0x57414941_4C455254 & 0x7FFFFFFFFFFFFFFF  # "WAIALERT"
DEFAULT_INTERVAL = 300.0
RETENTION_DAYS = 30
# Same error predicate as the dashboard KPIs (non-2xx).
_ERROR_PRED = "(status_code < 200 OR status_code >= 300)"

Emit = Callable[..., None]


def month_start(now: datetime) -> datetime:
    return now.astimezone(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_bucket(now: datetime) -> str:
    """Same UTC month window string the spend limiter uses for usage_hourly.bucket_hour."""
    return month_start(now).strftime("%Y-%m-%dT00:00:00+00:00")


def _hour_floor(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00+00:00")


def _num(v: Any, default: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@contextlib.asynccontextmanager
async def pg_advisory_lock(db: Any, key: int = ADVISORY_LOCK_KEY) -> AsyncIterator[bool]:
    """Yield True when this process holds the advisory lock for the duration of the block."""
    pool = getattr(db, "_pg_pool", None)
    if pool is None:
        yield True  # non-Postgres facade (tests / tooling): nothing to coordinate
        return
    async with pool.acquire() as conn:
        got = bool(await conn.fetchval("SELECT pg_try_advisory_lock($1)", key))
        try:
            yield got
        finally:
            if got:
                try:
                    await conn.fetchval("SELECT pg_advisory_unlock($1)", key)
                except Exception:
                    pass


class AlertScheduler:
    def __init__(
        self,
        db: Any,
        emit: Emit,
        *,
        interval: float = DEFAULT_INTERVAL,
        clock: Callable[[], datetime] = utc_now,
        lock: Callable[[], Any] | None = None,
        log: logging.Logger | None = None,
        retention_days: int = RETENTION_DAYS,
    ) -> None:
        self.db = db
        self._emit = emit
        self.interval = max(30.0, float(interval))
        self._clock = clock
        self._lock = lock or (lambda: pg_advisory_lock(db))
        self._log = log or logging.getLogger("wai.alerts")
        self._retention_days = retention_days
        self._emitted: set[str] = set()
        self._last_purge: datetime | None = None
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="alert-scheduler")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        # First run shortly after start-up, jittered so instances do not align.
        delay = 30.0 + random.uniform(0, 30)
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
                return
            except (TimeoutError, asyncio.TimeoutError):
                pass
            try:
                await self.run_once()
            except Exception as exc:
                self._log.warning("alert checks failed: %s", type(exc).__name__)
            delay = self.interval + random.uniform(-0.1, 0.1) * self.interval

    async def run_once(self) -> bool:
        """Run all checks if this instance gets the lock. Returns True when the checks ran."""
        async with self._lock() as got:
            if not got:
                return False
            now = self._clock()
            rules = await self._load_rules()
            for name, check in (
                ("budget", self.check_budgets),
                ("error_rate", self.check_error_rates),
                ("digest", self.check_digests),
            ):
                try:
                    await check(now, rules)
                except Exception as exc:
                    self._log.warning("alert %s check failed: %s", name, type(exc).__name__)
            await self._purge(now)
            return True

    async def _load_rules(self) -> dict[tuple[str, str], AlertRule]:
        rows = await self.db.fetchall("SELECT * FROM alert_rules", ())
        out: dict[tuple[str, str], AlertRule] = {}
        for r in rows:
            rule = AlertRule.from_row(dict(r))
            out[(rule.org_id or "", rule.kind)] = rule
        return out

    @staticmethod
    def _rule(rules: dict[tuple[str, str], AlertRule], org_id: str | None, kind: str) -> AlertRule:
        return rules.get((org_id or "", kind)) or AlertRule.default(kind, org_id)

    async def _already(self, dedupe_key: str) -> bool:
        if dedupe_key in self._emitted:
            return True
        row = await self.db.fetchone("SELECT id FROM alert_events WHERE dedupe_key = ? LIMIT 1", (dedupe_key,))
        if row is not None:
            self._emitted.add(dedupe_key)
            return True
        return False

    def _mark(self, dedupe_key: str) -> None:
        if len(self._emitted) > 50000:
            self._emitted.clear()
        self._emitted.add(dedupe_key)

    # --- (a) budget thresholds ----------------------------------------------------------

    async def check_budgets(self, now: datetime, rules: dict[tuple[str, str], AlertRule]) -> None:
        since = month_bucket(now)
        ym = month_start(now).strftime("%Y-%m")
        orgs = await self.db.fetchall(
            "SELECT id, name, monthly_spend_limit FROM organizations WHERE deleted_at IS NULL AND monthly_spend_limit > 0",
            (),
        )
        teams = await self.db.fetchall(
            "SELECT id, org_id, name, monthly_spend_limit FROM teams WHERE deleted_at IS NULL AND monthly_spend_limit > 0",
            (),
        )
        keys = await self.db.fetchall(
            "SELECT id, org_id, name, monthly_spend_limit FROM api_keys WHERE deleted_at IS NULL AND monthly_spend_limit > 0",
            (),
        )
        if not (orgs or teams or keys):
            return
        org_names = {r["id"]: r["name"] for r in orgs}

        async def spend_by(col: str) -> dict[str, float]:
            rows = await self.db.fetchall(
                f"SELECT {col} AS sid, COALESCE(SUM(cost_sum), 0) AS c FROM usage_hourly WHERE bucket_hour >= ? GROUP BY {col}",
                (since,),
            )
            return {r["sid"]: float(r["c"] or 0) for r in rows}

        entities: list[tuple[str, str, str, str, float, float]] = []  # scope, id, org_id, name, limit, used
        if orgs:
            spent = await spend_by("org_id")
            entities += [("org", r["id"], r["id"], r["name"], float(r["monthly_spend_limit"]), spent.get(r["id"], 0.0)) for r in orgs]
        if teams:
            spent = await spend_by("team_id")
            entities += [("team", r["id"], r["org_id"], r["name"], float(r["monthly_spend_limit"]), spent.get(r["id"], 0.0)) for r in teams]
        if keys:
            spent = await spend_by("key_id")
            entities += [("key", r["id"], r["org_id"], r["name"] or r["id"][:8], float(r["monthly_spend_limit"]), spent.get(r["id"], 0.0)) for r in keys]

        for scope, sid, org_id, name, limit, used in entities:
            rule = self._rule(rules, org_id, KIND_BUDGET)
            if not rule.enabled or limit <= 0:
                continue
            thresholds = sorted({int(_num(t, 0)) for t in (rule.params.get("thresholds") or [80, 100]) if 0 < _num(t, 0) <= 1000})
            pct = used / limit * 100.0
            crossed = [t for t in thresholds if pct >= t]
            if not crossed:
                continue
            top = crossed[-1]
            key = f"budget:{scope}:{sid}:{ym}:{top}"
            if await self._already(key):
                continue
            # A higher threshold already sent this month covers the lower ones.
            if any([await self._already(f"budget:{scope}:{sid}:{ym}:{t}") for t in thresholds if t > top]):
                continue
            severity = "critical" if top >= 100 else "warning"
            label = {"org": "Organization", "team": "Team", "key": "API key"}[scope]
            self._emit(
                KIND_BUDGET,
                severity,
                f"{label} '{name}' reached {top}% of its monthly budget",
                f"Month-to-date spend is ${used:,.2f} of the ${limit:,.2f} monthly limit ({pct:.0f}%, UTC month {ym}).",
                org_id=org_id,
                data={
                    "scope": scope, "entity_id": sid, "entity_name": name, "org_name": org_names.get(org_id, ""),
                    "threshold_pct": top, "spend_usd": round(used, 4), "limit_usd": round(limit, 4),
                    "percent": round(pct, 1), "month": ym,
                },
                dedupe_key=key,
            )
            self._mark(key)

    # --- (b) error rate ----------------------------------------------------------------

    async def check_error_rates(self, now: datetime, rules: dict[tuple[str, str], AlertRule]) -> None:
        def window_of(rule: AlertRule) -> int:
            return max(5, min(int(_num(rule.params.get("window_minutes"), 15)) or 15, 120))

        # One grouped query per distinct window (normally just the default 15 minutes).
        default_window = window_of(self._rule(rules, None, KIND_ERROR_RATE))
        windows = {default_window} | {
            window_of(r) for (org, kind), r in rules.items() if org and kind == KIND_ERROR_RATE and r.enabled
        }
        stats: dict[int, dict[str, tuple[int, int]]] = {}
        for window in sorted(windows):
            rows = await self.db.fetchall(
                f"""SELECT org_id, COUNT(*) AS n, SUM(CASE WHEN {_ERROR_PRED} THEN 1 ELSE 0 END) AS errs
                    FROM request_logs WHERE created_at >= ? GROUP BY org_id""",
                (iso(now - timedelta(minutes=window)),),
            )
            stats[window] = {r["org_id"]: (int(r["n"] or 0), int(r["errs"] or 0)) for r in rows if r["org_id"]}
        for org_id in sorted({o for s in stats.values() for o in s}):
            rule = self._rule(rules, org_id, KIND_ERROR_RATE)
            if not rule.enabled:
                continue
            window = window_of(rule) if (org_id, KIND_ERROR_RATE) in rules else default_window
            n, errs = stats.get(window, {}).get(org_id, (0, 0))
            min_requests = max(1, int(_num(rule.params.get("min_requests"), 20)))
            threshold = _num(rule.params.get("threshold_pct"), 10.0)
            if n < min_requests:
                continue
            rate = errs / n * 100.0
            if rate < threshold:
                continue
            severity = "critical" if rate >= max(50.0, threshold * 3) else "warning"
            self._emit(
                KIND_ERROR_RATE,
                severity,
                f"High error rate: {rate:.0f}% of requests failed",
                f"{errs} of {n} requests failed in the last {window} minutes (threshold {threshold:g}%).",
                org_id=org_id,
                data={"requests": n, "errors": errs, "error_rate_pct": round(rate, 1), "window_minutes": window,
                      "threshold_pct": threshold},
                dedupe_key=f"error_rate:{org_id}",
            )

    # --- (c) daily digest --------------------------------------------------------------

    async def check_digests(self, now: datetime, rules: dict[tuple[str, str], AlertRule]) -> None:
        enabled = [r for r in rules.values() if r.kind == KIND_DIGEST and r.enabled]
        if not enabled:
            return
        day = now.astimezone(timezone.utc).strftime("%Y-%m-%d")
        for rule in enabled:
            hour = int(_num(rule.params.get("hour_utc"), 3)) % 24
            minute = int(_num(rule.params.get("minute_utc"), 30)) % 60
            due = now.astimezone(timezone.utc).replace(hour=hour, minute=minute, second=0, microsecond=0)
            if now < due:
                continue
            key = f"digest:{rule.org_id or 'platform'}:{day}"
            if await self._already(key):
                continue
            summary = await self._summary(rule.org_id, now)
            top = ", ".join(f"{m['model']} ({m['requests']})" for m in summary["top_models"]) or "none"
            scope_label = "Platform" if not rule.org_id else (summary.get("org_name") or "Organization")
            self._emit(
                KIND_DIGEST,
                "info",
                f"{scope_label} daily summary for the last 24 hours",
                f"{summary['requests']:,} requests, ${summary['cost_usd']:,.2f} spend, {summary['errors']:,} errors. "
                f"Top models: {top}.",
                org_id=rule.org_id,
                data={**{k: v for k, v in summary.items() if k != "top_models"},
                      "top_models": [f"{m['model']}: {m['requests']}" for m in summary["top_models"]]},
                dedupe_key=key,
            )
            self._mark(key)

    async def _summary(self, org_id: str | None, now: datetime) -> dict[str, Any]:
        since_bucket = _hour_floor(now - timedelta(hours=24))
        since = iso(now - timedelta(hours=24))
        org_sql, org_params = ("AND org_id = ?", (org_id,)) if org_id else ("", ())
        tot = await self.db.fetchone(
            f"""SELECT COALESCE(SUM(request_count), 0) AS n, COALESCE(SUM(cost_sum), 0) AS c
                FROM usage_hourly WHERE bucket_hour >= ? {org_sql}""",
            (since_bucket, *org_params),
        )
        models = await self.db.fetchall(
            f"""SELECT model_name, SUM(request_count) AS n FROM usage_hourly WHERE bucket_hour >= ? {org_sql}
                GROUP BY model_name ORDER BY n DESC LIMIT 5""",
            (since_bucket, *org_params),
        )
        errs = await self.db.fetchone(
            f"SELECT COUNT(*) AS e FROM request_logs WHERE created_at >= ? AND {_ERROR_PRED} {org_sql}",
            (since, *org_params),
        )
        out: dict[str, Any] = {
            "requests": int((tot or {}).get("n") or 0),
            "cost_usd": round(float((tot or {}).get("c") or 0), 4),
            "errors": int((errs or {}).get("e") or 0),
            "top_models": [{"model": m["model_name"], "requests": int(m["n"] or 0)} for m in models],
        }
        if org_id:
            org = await self.db.fetchone("SELECT name FROM organizations WHERE id = ?", (org_id,))
            out["org_name"] = (org or {}).get("name") or ""
        return out

    # --- retention ---------------------------------------------------------------------

    async def _purge(self, now: datetime) -> None:
        if self._last_purge is not None and now - self._last_purge < timedelta(hours=6):
            return
        self._last_purge = now
        try:
            await self.db.execute(
                "DELETE FROM alert_events WHERE created_at < ?", (iso(now - timedelta(days=self._retention_days)),)
            )
        except Exception as exc:
            self._log.warning("alert event purge failed: %s", type(exc).__name__)
