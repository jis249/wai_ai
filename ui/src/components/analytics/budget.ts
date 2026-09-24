import type { TimeSeriesPoint } from '../ui/charts/TimeSeriesChart'
import { bucketStartMs, formatBucketLabel, formatBucketTooltip, GRANULARITY_MS } from './timeSeries'

/** Current UTC calendar month (the window the spend limiter uses). */
export function currentUtcMonth(now: Date = new Date()): { start: string; end: string; now: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), now: now.toISOString() }
}

/** Cumulative month-to-date spend per UTC day; days after today are null (gap). */
export function cumulativeMonthSeries(
  month: { start: string; end: string; now: string },
  days: readonly { key: string; cost: number }[],
): TimeSeriesPoint[] {
  const byDay = new Map<number, number>()
  for (const d of days) {
    const ms = bucketStartMs(d.key)
    if (!Number.isNaN(ms)) byDay.set(ms, (byDay.get(ms) ?? 0) + (Number.isFinite(d.cost) ? d.cost : 0))
  }
  const nowMs = Date.parse(month.now)
  const out: TimeSeriesPoint[] = []
  let running = 0
  for (let ms = Date.parse(month.start); ms < Date.parse(month.end); ms += GRANULARITY_MS.day) {
    running += byDay.get(ms) ?? 0
    out.push({
      label: formatBucketLabel(ms, 'day'),
      tooltipLabel: formatBucketTooltip(ms, 'day'),
      value: ms <= nowMs ? running : null,
    })
  }
  return out
}
