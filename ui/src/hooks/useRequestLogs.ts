import { useInfiniteQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface RequestLogRow {
  id: string
  created_at: string
  status: number
  /** What the client asked for (e.g. "auto" or an alias). */
  model: string
  /** The concrete model that served the request. */
  routed_model: string
  key_hint: string
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  latency_ms: number
  cache_hit: boolean
  /** Error message for failed requests ('' on success). */
  error: string
}

export interface RequestLogsPage {
  data: RequestLogRow[]
  has_more: boolean
  next_before: string
  next_before_id: string
  /** Newest row in this response (live-tail cursor), '' when empty. */
  latest_created_at?: string
  latest_id?: string
}

export type RequestLogStatusFilter = 'success' | 'error'

export interface RequestLogFilters {
  status?: RequestLogStatusFilter
  /** Exact match against requested or routed model. */
  model?: string
  key_id?: string
  /** ISO 8601 lower bound (inclusive). */
  from?: string
  /** ISO 8601 upper bound (exclusive). */
  to?: string
}

export const REQUEST_LOGS_PAGE_SIZE = 50

interface Cursor {
  before: string
  before_id: string
}

/** Live-tail cursor: only rows strictly newer than (created_at, id). */
export interface AfterCursor {
  after: string
  after_id: string
}

/** Build the `/usage/request-logs` query string (exported for tests). */
export function buildRequestLogsQuery(
  filters: RequestLogFilters,
  cursor: Cursor | null,
  limit = REQUEST_LOGS_PAGE_SIZE,
  after: AfterCursor | null = null,
): string {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (cursor) {
    params.set('before', cursor.before)
    if (cursor.before_id) params.set('before_id', cursor.before_id)
  }
  if (after) {
    params.set('after', after.after)
    if (after.after_id) params.set('after_id', after.after_id)
  }
  if (filters.model) params.set('model', filters.model)
  if (filters.status) params.set('status', filters.status)
  if (filters.key_id) params.set('key_id', filters.key_id)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  return params.toString()
}

/** Cursor-paginated proxy request log (newest first). Use `fetchNextPage()` for "Load more". */
export function useRequestLogs(filters: RequestLogFilters = {}) {
  const normalized: RequestLogFilters = {
    status: filters.status,
    model: filters.model?.trim() || undefined,
    key_id: filters.key_id || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  }
  return useInfiniteQuery({
    queryKey: ['request-logs', normalized],
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam }) =>
      apiClient<RequestLogsPage>(`/usage/request-logs?${buildRequestLogsQuery(normalized, pageParam)}`),
    getNextPageParam: (last): Cursor | undefined =>
      last.has_more && last.next_before ? { before: last.next_before, before_id: last.next_before_id } : undefined,
  })
}

export const LIVE_TAIL_PAGE_SIZE = 200

/** One live-tail poll: rows newer than `after` (newest first), same filters. */
export function fetchRequestLogsAfter(
  filters: RequestLogFilters,
  after: AfterCursor,
  limit = LIVE_TAIL_PAGE_SIZE,
): Promise<RequestLogsPage> {
  return apiClient<RequestLogsPage>(`/usage/request-logs?${buildRequestLogsQuery(filters, null, limit, after)}`)
}

/** Mirrors the backend `status=success` filter: 2xx is success, everything else is an error. */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

export function totalTokens(row: Pick<RequestLogRow, 'prompt_tokens' | 'completion_tokens'>): number {
  return (row.prompt_tokens || 0) + (row.completion_tokens || 0)
}
