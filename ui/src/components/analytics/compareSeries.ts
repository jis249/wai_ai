import type { TimeGranularity } from '../../lib/timeRange'
import type { TimeSeriesPoint } from '../ui/charts/TimeSeriesChart'
import {
  alignToAxis,
  bucketIso,
  buildBucketAxis,
  formatBucketLabel,
  formatBucketTooltip,
} from './timeSeries'

export interface ComparePoint extends TimeSeriesPoint {
  /** Bucket start (ISO) for drill-down links. */
  bucket: string
}

/**
 * Zero-filled chart points for [from, to) at `granularity`, with the previous
 * window (same length, immediately before) aligned bucket-for-bucket when given.
 */
export function buildCompareSeries(opts: {
  from: string
  to: string
  granularity: TimeGranularity
  current: readonly { key: string; value: number }[]
  previous?: readonly { key: string; value: number }[] | null
}): ComparePoint[] {
  const { from, to, granularity, current, previous } = opts
  const axis = buildBucketAxis(from, to, granularity)
  const span = Date.parse(to) - Date.parse(from)
  const cur = alignToAxis(axis, current, granularity)
  const prev = previous != null ? alignToAxis(axis, previous, granularity, span) : null
  return axis.map((ms, i) => ({
    bucket: bucketIso(ms),
    label: formatBucketLabel(ms, granularity),
    tooltipLabel: formatBucketTooltip(ms, granularity),
    value: cur[i],
    previous: prev != null ? prev[i] : undefined,
  }))
}
