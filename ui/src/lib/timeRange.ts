import { useMemo } from 'react'

/**
 * Shared time-range model for usage / audit / cost pages.
 *
 * Replaces the per-page TIME_RANGES + getTimeRange copies. A range is either a
 * preset ("24h", "7d", ...) relative to now, or a custom absolute {from, to}
 * (ISO 8601 UTC strings). Everything the API needs comes from `getTimeRange()`.
 */

export const ALL_TIME_RANGE_PRESETS = ['1h', '24h', '7d', '30d', '90d'] as const
export type TimeRangePreset = (typeof ALL_TIME_RANGE_PRESETS)[number]

/** Default preset set used by most pages (usage, audit, auto-routing). */
export const TIME_RANGE_PRESETS: readonly TimeRangePreset[] = ['24h', '7d', '30d', '90d']
/** Preset set used by cost reports (no sub-week view). */
export const COST_TIME_RANGE_PRESETS: readonly TimeRangePreset[] = ['7d', '30d', '90d']
/** Preset set used by the dashboard. */
export const DASHBOARD_TIME_RANGE_PRESETS: readonly TimeRangePreset[] = ['24h', '7d', '30d']

export const TIME_RANGE_HOURS: Record<TimeRangePreset, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 168,
  '30d': 720,
  '90d': 2160,
}

export type TimeRangeLabelStyle = 'short' | 'medium' | 'long'

/** short: "7d" · medium: "Last 7d" · long: "Last 7 days" */
export const TIME_RANGE_LABELS: Record<TimeRangePreset, Record<TimeRangeLabelStyle, string>> = {
  '1h': { short: '1h', medium: 'Last 1h', long: 'Last hour' },
  '24h': { short: '24h', medium: 'Last 24h', long: 'Last 24 hours' },
  '7d': { short: '7d', medium: 'Last 7d', long: 'Last 7 days' },
  '30d': { short: '30d', medium: 'Last 30d', long: 'Last 30 days' },
  '90d': { short: '90d', medium: 'Last 90d', long: 'Last 90 days' },
}

/** Absolute range; both ends ISO 8601 strings. */
export interface CustomTimeRange {
  from: string
  to: string
}

export type TimeRangeValue = TimeRangePreset | CustomTimeRange

/** Bucket size hint for time-series queries (`group_by` = 'hour' | 'day'). */
export type TimeGranularity = 'hour' | 'day'

export interface ResolvedTimeRange {
  /** ISO 8601 (UTC) start. */
  from: string
  /** ISO 8601 (UTC) end. */
  to: string
  /** Span in hours (fractional for custom ranges). */
  hours: number
  /** 'hour' for spans up to 48h, otherwise 'day'. */
  granularity: TimeGranularity
  /** The preset, or null for custom ranges. */
  preset: TimeRangePreset | null
}

const HOUR_MS = 3_600_000

export function isTimeRangePreset(value: unknown): value is TimeRangePreset {
  return typeof value === 'string' && (ALL_TIME_RANGE_PRESETS as readonly string[]).includes(value)
}

export function isCustomTimeRange(value: TimeRangeValue | null | undefined): value is CustomTimeRange {
  return typeof value === 'object' && value != null && 'from' in value && 'to' in value
}

/** Suggested series granularity for a span. */
export function granularityForHours(hours: number): TimeGranularity {
  return hours <= 48 ? 'hour' : 'day'
}

/**
 * Resolve a range to concrete ISO bounds. Presets are computed relative to `now`
 * (default: current time) using fixed-length hours, matching the previous per-page
 * implementations.
 */
export function getTimeRange(value: TimeRangeValue, now: Date = new Date()): ResolvedTimeRange {
  if (isCustomTimeRange(value)) {
    const fromMs = new Date(value.from).getTime()
    const toMs = new Date(value.to).getTime()
    const hours = Math.max(0, (toMs - fromMs) / HOUR_MS)
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      hours,
      granularity: granularityForHours(hours),
      preset: null,
    }
  }
  const hours = TIME_RANGE_HOURS[value]
  const from = new Date(now.getTime() - hours * HOUR_MS)
  return { from: from.toISOString(), to: now.toISOString(), hours, granularity: granularityForHours(hours), preset: value }
}

/** Stable string identity for a range — use as a memo/query dependency. */
export function timeRangeKey(value: TimeRangeValue): string {
  return isCustomTimeRange(value) ? `${value.from}..${value.to}` : value
}

/** Inverse of `timeRangeKey` (also for URL search params). Returns null when unparseable. */
export function parseTimeRange(raw: string | null | undefined): TimeRangeValue | null {
  if (!raw) return null
  if (isTimeRangePreset(raw)) return raw
  const [from, to] = raw.split('..')
  if (!from || !to) return null
  if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) return null
  return { from, to }
}

/** Serialize for URL search params (same as `timeRangeKey`). */
export const serializeTimeRange = timeRangeKey

/** Display label. Custom ranges render as "Mar 3, 14:00 – Mar 5, 09:30" in the user's locale. */
export function timeRangeLabel(value: TimeRangeValue, style: TimeRangeLabelStyle = 'medium'): string {
  if (!isCustomTimeRange(value)) return TIME_RANGE_LABELS[value][style]
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${fmt.format(new Date(value.from))} – ${fmt.format(new Date(value.to))}`
}

/** ISO string → value for `<input type="datetime-local">` (local time, minute precision). */
export function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `<input type="datetime-local">` value (local time) → ISO string, or '' if invalid. */
export function fromDateTimeLocalValue(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/**
 * Memoized `getTimeRange` — recomputes only when the range identity changes, so
 * preset bounds (which depend on "now") stay stable across re-renders and don't
 * churn TanStack Query keys. Pass `refreshKey` (e.g. a counter bumped by a
 * Refresh button) to re-anchor presets to the current time.
 */
export function useTimeRange(value: TimeRangeValue, refreshKey?: unknown): ResolvedTimeRange {
  const key = timeRangeKey(value)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `value`; refreshKey re-anchors "now"
  return useMemo(() => getTimeRange(value), [key, refreshKey])
}
