import { serializeTimeRange, type TimeRangeValue } from '../../lib/timeRange'
import type { TimeGranularity } from '../../lib/timeRange'
import { bucketStartMs, GRANULARITY_MS } from './timeSeries'

/**
 * Deep links into the request log (`/usage/logs`). Param format mirrors
 * RequestLogsPage: `status` (success|error), `model`, `key_id`, `range`
 * (a preset like "7d" or "fromISO..toISO"), `request` (opens that row).
 */
export interface LogsDrilldown {
  status?: 'success' | 'error'
  model?: string
  keyId?: string
  range?: TimeRangeValue
  request?: string
}

export const REQUEST_LOGS_PATH = '/usage/logs'

export function requestLogsUrl({ status, model, keyId, range, request }: LogsDrilldown = {}): string {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (model) params.set('model', model)
  if (keyId) params.set('key_id', keyId)
  if (range != null) params.set('range', serializeTimeRange(range))
  if (request) params.set('request', request)
  const qs = params.toString()
  return qs ? `${REQUEST_LOGS_PATH}?${qs}` : REQUEST_LOGS_PATH
}

/** Absolute range covering one chart bucket (`bucket` = its start, ISO or "YYYY-MM-DD"). */
export function bucketRange(bucket: string, granularity: TimeGranularity): TimeRangeValue | undefined {
  const start = bucketStartMs(bucket)
  if (Number.isNaN(start)) return undefined
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + GRANULARITY_MS[granularity]).toISOString(),
  }
}
