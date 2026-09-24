import type { TimeGranularity } from '../../lib/timeRange'

/**
 * Helpers for time-bucketed series (usage API `group_by=day|hour`, dashboard KPIs).
 *
 * Buckets are UTC: day keys look like "2026-09-24", hour keys like
 * "2026-09-24T10:00:00+00:00" (or the 13-char prefix "2026-09-24T10"). The usage API
 * omits empty buckets, so charts build a full axis and zero-fill it.
 */

export const GRANULARITY_MS: Record<TimeGranularity, number> = {
  hour: 3_600_000,
  day: 86_400_000,
}

/** Start of a bucket in epoch ms (NaN when unparseable). */
export function bucketStartMs(key: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return Date.parse(`${key}T00:00:00Z`)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key)) return Date.parse(`${key}:00:00Z`)
  return Date.parse(key)
}

export function floorToBucket(ms: number, granularity: TimeGranularity): number {
  const size = GRANULARITY_MS[granularity]
  return Math.floor(ms / size) * size
}

/** The equal-length window immediately before [from, to). */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const f = Date.parse(from)
  const t = Date.parse(to)
  const span = Math.max(0, t - f)
  return { from: new Date(f - span).toISOString(), to: new Date(f).toISOString() }
}

/** Bucket starts (epoch ms) covering [from, to), capped at `max` buckets (newest kept). */
export function buildBucketAxis(from: string, to: string, granularity: TimeGranularity, max = 2000): number[] {
  const f = Date.parse(from)
  const t = Date.parse(to)
  if (Number.isNaN(f) || Number.isNaN(t) || t <= f) return []
  const size = GRANULARITY_MS[granularity]
  const out: number[] = []
  for (let ms = floorToBucket(f, granularity); ms < t; ms += size) out.push(ms)
  return out.length > max ? out.slice(out.length - max) : out
}

/**
 * Sum `points` into the axis buckets. `offsetMs` shifts each point before bucketing,
 * e.g. the previous window's span so last week's Monday lands on this week's Monday.
 */
export function alignToAxis(
  axis: readonly number[],
  points: readonly { key: string; value: number }[],
  granularity: TimeGranularity,
  offsetMs = 0,
): number[] {
  const index = new Map(axis.map((ms, i) => [ms, i]))
  const out = axis.map(() => 0)
  for (const p of points) {
    const start = bucketStartMs(p.key)
    if (Number.isNaN(start)) continue
    const i = index.get(floorToBucket(start + offsetMs, granularity))
    if (i != null) out[i] += Number.isFinite(p.value) ? p.value : 0
  }
  return out
}

/** Short axis label: "14:00" (local time) for hours, "Sep 24" (UTC day) for days. */
export function formatBucketLabel(ms: number, granularity: TimeGranularity): string {
  const d = new Date(ms)
  if (granularity === 'hour') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Tooltip label: "Sep 24, 14:00" for hours, "Wed, Sep 24" for days. */
export function formatBucketTooltip(ms: number, granularity: TimeGranularity): string {
  const d = new Date(ms)
  if (granularity === 'hour') {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Canonical ISO for a bucket start (for drill-down links). */
export function bucketIso(ms: number): string {
  return new Date(ms).toISOString()
}
