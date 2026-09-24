"""Dashboard statistics handler."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from wai.api.admin.common import (
    KeyInfo,
    ROLE_ORG_ADMIN,
    ROLE_SYSTEM_ADMIN,
    ROLE_TEAM_ADMIN,
    bad_request,
    internal_error,
)
from wai.api.admin.handler import auth_middleware, get_handler
from wai.api.admin import repository as repo

router = APIRouter()

WARN_THRESHOLD = 0.80


class BudgetWarning(BaseModel):
    window: str
    scope: str
    limit: int
    usage: int
    percent_used: float


class DashboardStatsResponse(BaseModel):
    scope: str
    active_keys: int = 0
    total_teams: int | None = None
    total_members: int | None = None
    requests_24h: int = 0
    tokens_24h: int = 0
    cost_estimate_24h: float = 0
    budget_warnings: list[BudgetWarning] = Field(default_factory=list)
    models_healthy: int = 0
    models_unhealthy: int = 0
    models_degraded: int = 0


@router.get("/dashboard/stats", response_model=DashboardStatsResponse)
async def dashboard_stats(key_info: KeyInfo = Depends(auth_middleware)) -> DashboardStatsResponse:
    h = get_handler()
    org_id = key_info.org_id
    from_dt = datetime.now(timezone.utc) - timedelta(hours=24)
    from_iso = from_dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    resp = DashboardStatsResponse(scope="user")

    if key_info.role in (ROLE_SYSTEM_ADMIN, ROLE_ORG_ADMIN):
        resp.scope = "org"
        resp.active_keys = await repo.count_active_keys(h.db, org_id)
        resp.total_teams = await repo.count_teams(h.db, org_id)
        resp.total_members = await repo.count_org_members(h.db, org_id)
        team_id = ""
        user_id = ""
    elif key_info.role == ROLE_TEAM_ADMIN:
        team_id = key_info.team_id
        if not team_id:
            team_id = await repo.get_user_team_id(h.db, org_id, key_info.user_id)
        user_id = ""
        if team_id:
            resp.scope = "team"
            resp.active_keys = await repo.count_team_keys(h.db, team_id)
            resp.total_members = await repo.count_team_members(h.db, team_id)
        else:
            return resp
    else:
        team_id = ""
        user_id = key_info.user_id
        resp.scope = "user"
        resp.active_keys = await repo.count_user_keys(h.db, org_id, key_info.user_id)

    agg = await repo.get_hourly_usage_totals(h.db, org_id, team_id, user_id, from_iso)
    resp.requests_24h = int(agg.get("total_requests") or 0)
    resp.tokens_24h = int(agg.get("total_tokens") or 0)
    resp.cost_estimate_24h = float(agg.get("cost_estimate") or 0)

    if resp.scope == "org":
        org = await repo.get_org(h.db, org_id)
        if org:
            if org.get("daily_token_limit", 0) > 0:
                pct = resp.tokens_24h / org["daily_token_limit"]
                if pct >= WARN_THRESHOLD:
                    resp.budget_warnings.append(
                        BudgetWarning(
                            window="daily", scope="org",
                            limit=int(org["daily_token_limit"]),
                            usage=resp.tokens_24h, percent_used=pct,
                        )
                    )
            if org.get("monthly_token_limit", 0) > 0:
                monthly = await repo.get_monthly_token_usage(h.db, org_id)
                pct = monthly / org["monthly_token_limit"]
                if pct >= WARN_THRESHOLD:
                    resp.budget_warnings.append(
                        BudgetWarning(
                            window="monthly", scope="org",
                            limit=int(org["monthly_token_limit"]),
                            usage=monthly, percent_used=pct,
                        )
                    )
            spend_limit = float(org.get("monthly_spend_limit") or 0)
            if spend_limit > 0:
                spent = await repo.get_monthly_spend(h.db, org_id)
                pct = spent / spend_limit
                if pct >= WARN_THRESHOLD:
                    resp.budget_warnings.append(
                        BudgetWarning(
                            window="monthly_spend",
                            scope="org",
                            limit=int(spend_limit),
                            usage=int(spent),
                            percent_used=pct,
                        )
                    )

    if h.health_checker is not None:
        for mh in h.health_checker.get_all_health():
            status = mh.get("status") if isinstance(mh, dict) else getattr(mh, "status", "")
            if status == "healthy":
                resp.models_healthy += 1
            elif status == "unhealthy":
                resp.models_unhealthy += 1
            elif status == "degraded":
                resp.models_degraded += 1

    return resp


# --- KPIs ----------------------------------------------------------------------------------

KPI_DEFAULT_WINDOW = timedelta(hours=24)
KPI_MAX_WINDOW = timedelta(days=366)
KPI_HOURLY_MAX_WINDOW = timedelta(hours=48)
_LOG_TS_FMT = "%Y-%m-%dT%H:%M:%S+00:00"


class KpiTotals(BaseModel):
    requests: int = 0
    errors: int = 0
    error_rate: float = 0.0
    tokens: int = 0
    cost_usd: float = 0.0
    cache_hits: int = 0
    cache_hit_rate: float = 0.0
    latency_p50_ms: int = 0
    latency_p95_ms: int = 0


class KpiSeriesPoint(BaseModel):
    bucket: str
    requests: int = 0
    errors: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    latency_p95_ms: int = 0


class DashboardKpisResponse(BaseModel):
    current: KpiTotals = Field(default_factory=KpiTotals)
    previous: KpiTotals = Field(default_factory=KpiTotals)
    granularity: str = "hour"
    series: list[KpiSeriesPoint] = Field(default_factory=list)


def _parse_kpi_ts(value: str, name: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise bad_request(f"{name} must be a valid RFC3339 timestamp")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    # request_logs.created_at has second precision.
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def kpi_window(from_str: str, to_str: str, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Resolve and validate the [from, to) KPI window (default: the last 24h)."""
    to_dt = _parse_kpi_ts(to_str, "to") if to_str else None
    from_dt = _parse_kpi_ts(from_str, "from") if from_str else None
    if to_dt is None:
        if from_dt is None:
            now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
            to_dt = now.replace(microsecond=0)
        else:
            to_dt = max(
                (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0),
                from_dt + timedelta(seconds=1),
            )
    if from_dt is None:
        from_dt = to_dt - KPI_DEFAULT_WINDOW
    if from_dt >= to_dt:
        raise bad_request("from must be before to")
    if to_dt - from_dt > KPI_MAX_WINDOW:
        raise bad_request("time range must not exceed 366 days")
    return from_dt, to_dt


def kpi_granularity(from_dt: datetime, to_dt: datetime) -> str:
    return "hour" if to_dt - from_dt <= KPI_HOURLY_MAX_WINDOW else "day"


def kpi_buckets(from_dt: datetime, to_dt: datetime, granularity: str) -> list[datetime]:
    """UTC bucket starts covering [from, to); the first may start before ``from``."""
    if granularity == "hour":
        cur = from_dt.replace(minute=0, second=0, microsecond=0)
        step = timedelta(hours=1)
    else:
        cur = from_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)
    out: list[datetime] = []
    while cur < to_dt:
        out.append(cur)
        cur += step
    return out


def _bucket_key(dt: datetime, granularity: str) -> str:
    return dt.strftime(_LOG_TS_FMT)[: repo.KPI_BUCKET_PREFIX_LEN[granularity]]


def _ms(value) -> int:
    return int(round(float(value))) if value is not None else 0


def kpi_totals(row: dict | None) -> KpiTotals:
    row = row or {}
    requests = int(row.get("requests") or 0)
    errors = int(row.get("errors") or 0)
    cache_hits = int(row.get("cache_hits") or 0)
    return KpiTotals(
        requests=requests,
        errors=errors,
        error_rate=(errors / requests) if requests else 0.0,
        tokens=int(row.get("tokens") or 0),
        cost_usd=float(row.get("cost_usd") or 0),
        cache_hits=cache_hits,
        cache_hit_rate=(cache_hits / requests) if requests else 0.0,
        latency_p50_ms=_ms(row.get("latency_p50_ms")),
        latency_p95_ms=_ms(row.get("latency_p95_ms")),
    )


def kpi_series(
    rows: list[dict], from_dt: datetime, to_dt: datetime, granularity: str
) -> list[KpiSeriesPoint]:
    """Gap-fill SQL bucket rows into a contiguous series (empty buckets are zeros)."""
    by_key = {str(r.get("bucket") or ""): r for r in rows}
    out: list[KpiSeriesPoint] = []
    for start in kpi_buckets(from_dt, to_dt, granularity):
        r = by_key.get(_bucket_key(start, granularity)) or {}
        out.append(
            KpiSeriesPoint(
                bucket=start.strftime(_LOG_TS_FMT),
                requests=int(r.get("requests") or 0),
                errors=int(r.get("errors") or 0),
                tokens=int(r.get("tokens") or 0),
                cost_usd=float(r.get("cost_usd") or 0),
                latency_p95_ms=_ms(r.get("latency_p95_ms")),
            )
        )
    return out


async def kpi_scope(db, key_info: KeyInfo) -> tuple[str, str, str] | None:
    """(org_id, team_id, user_id) for request_logs, or None when nothing is visible.

    System admin: their own org, matching /dashboard/stats (all orgs only when they have no
    org); org admin: their org; team admin: their team's keys (resolved like /dashboard/stats);
    anyone else: their own keys.
    """
    if key_info.role == ROLE_SYSTEM_ADMIN:
        return key_info.org_id or "", "", ""
    org_id = key_info.org_id
    if not org_id:
        return None
    if key_info.role == ROLE_ORG_ADMIN:
        return org_id, "", ""
    if key_info.role == ROLE_TEAM_ADMIN:
        team_id = key_info.team_id or await repo.get_user_team_id(db, org_id, key_info.user_id)
        return (org_id, team_id, "") if team_id else None
    if not key_info.user_id:
        return None
    return org_id, "", key_info.user_id


@router.get("/dashboard/kpis", response_model=DashboardKpisResponse)
async def dashboard_kpis(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    key_info: KeyInfo = Depends(auth_middleware),
) -> DashboardKpisResponse:
    h = get_handler()
    from_dt, to_dt = kpi_window(from_, to)
    granularity = kpi_granularity(from_dt, to_dt)
    prev_from_dt = from_dt - (to_dt - from_dt)
    resp = DashboardKpisResponse(granularity=granularity)

    scope = await kpi_scope(h.db, key_info)
    if scope is None:
        resp.series = kpi_series([], from_dt, to_dt, granularity)
        return resp
    org_id, team_id, user_id = scope
    from_ts = from_dt.strftime(_LOG_TS_FMT)
    to_ts = to_dt.strftime(_LOG_TS_FMT)
    prev_ts = prev_from_dt.strftime(_LOG_TS_FMT)

    current = await repo.get_request_log_kpi_totals(h.db, org_id, team_id, user_id, from_ts, to_ts)
    previous = await repo.get_request_log_kpi_totals(h.db, org_id, team_id, user_id, prev_ts, from_ts)
    rows = await repo.get_request_log_kpi_series(
        h.db, org_id, team_id, user_id, from_ts, to_ts, granularity,
    )
    resp.current = kpi_totals(current)
    resp.previous = kpi_totals(previous)
    resp.series = kpi_series(rows, from_dt, to_dt, granularity)
    return resp
