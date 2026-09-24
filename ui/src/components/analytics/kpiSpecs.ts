import type { DashboardKpis } from '../../hooks/useDashboardKpis'
import { chartColor } from '../../lib/chartColors'
import type { TimeRangeValue } from '../../lib/timeRange'
import { formatCost, formatNumber, formatTokens } from '../../lib/utils'
import { computeKpiDelta, type KpiDelta } from './kpi'
import { requestLogsUrl } from './drilldown'

export interface KpiSpec {
  id: 'requests' | 'error_rate' | 'latency_p95' | 'cache_hit_rate' | 'cost' | 'tokens'
  label: string
  value: string
  delta: KpiDelta
  trend: number[]
  trendSummary?: string
  href: string
  linkHint: string
  color: string
}

export function formatPercent(fraction: number): string {
  const pct = (Number.isFinite(fraction) ? fraction : 0) * 100
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`
}

export function formatMs(ms: number): string {
  return `${formatNumber(Math.round(Number.isFinite(ms) ? ms : 0))} ms`
}

function summarize(values: number[], format: (n: number) => string, unit: string): string | undefined {
  if (values.length === 0) return undefined
  const min = Math.min(...values)
  const max = Math.max(...values)
  return `Trend across ${values.length} ${unit}${values.length === 1 ? '' : 's'}: low ${format(min)}, high ${format(max)}, latest ${format(values[values.length - 1])}.`
}

/** Card specs (value, delta semantics, sparkline, drill-down) for the dashboard KPI row. */
export function buildKpiSpecs(data: DashboardKpis, range: TimeRangeValue): KpiSpec[] {
  const { current: c, previous: p, series } = data
  const unit = data.granularity === 'hour' ? 'hour' : 'day'
  const errorRates = series.map((b) => (b.requests > 0 ? b.errors / b.requests : 0))
  const logs = requestLogsUrl({ range })

  return [
    {
      id: 'requests',
      label: 'Requests',
      value: formatNumber(c.requests),
      delta: computeKpiDelta(c.requests, p.requests, { goodWhen: 'up' }),
      trend: series.map((b) => b.requests),
      trendSummary: summarize(series.map((b) => b.requests), formatNumber, unit),
      href: logs,
      linkHint: 'View requests in request logs',
      color: chartColor(0),
    },
    {
      id: 'error_rate',
      label: 'Error rate',
      value: formatPercent(c.error_rate),
      delta: computeKpiDelta(c.error_rate, p.error_rate, { kind: 'points', goodWhen: 'down' }),
      trend: errorRates,
      trendSummary: summarize(errorRates, formatPercent, unit),
      href: requestLogsUrl({ status: 'error', range }),
      linkHint: `${formatNumber(c.errors)} errors. View errors in request logs`,
      color: chartColor(0),
    },
    {
      id: 'latency_p95',
      label: 'p95 latency',
      value: formatMs(c.latency_p95_ms),
      delta: computeKpiDelta(c.latency_p95_ms, p.latency_p95_ms, { goodWhen: 'down' }),
      trend: series.map((b) => b.latency_p95_ms),
      trendSummary: summarize(series.map((b) => b.latency_p95_ms), formatMs, unit),
      href: logs,
      linkHint: `Median ${formatMs(c.latency_p50_ms)}. View requests in request logs`,
      color: chartColor(0),
    },
    {
      id: 'cache_hit_rate',
      label: 'Cache hit rate',
      value: formatPercent(c.cache_hit_rate),
      delta: computeKpiDelta(c.cache_hit_rate, p.cache_hit_rate, { kind: 'points', goodWhen: 'up' }),
      // The KPI series has no per-bucket cache hits, so this card has no sparkline.
      trend: [],
      href: logs,
      linkHint: `${formatNumber(c.cache_hits)} cache hits. View requests in request logs`,
      color: chartColor(0),
    },
    {
      id: 'cost',
      label: 'Est. cost',
      value: formatCost(c.cost_usd),
      delta: computeKpiDelta(c.cost_usd, p.cost_usd, { goodWhen: 'neutral' }),
      trend: series.map((b) => b.cost_usd),
      trendSummary: summarize(series.map((b) => b.cost_usd), formatCost, unit),
      href: logs,
      linkHint: 'View requests in request logs',
      color: chartColor(0),
    },
    {
      id: 'tokens',
      label: 'Tokens',
      value: formatTokens(c.tokens),
      delta: computeKpiDelta(c.tokens, p.tokens, { goodWhen: 'neutral' }),
      trend: series.map((b) => b.tokens),
      trendSummary: summarize(series.map((b) => b.tokens), formatTokens, unit),
      href: logs,
      linkHint: 'View requests in request logs',
      color: chartColor(0),
    },
  ]
}
