import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

/** Totals for one window (`error_rate` / `cache_hit_rate` are 0..1 fractions). */
export interface DashboardKpiTotals {
  requests: number
  errors: number
  error_rate: number
  tokens: number
  cost_usd: number
  cache_hits: number
  cache_hit_rate: number
  latency_p50_ms: number
  latency_p95_ms: number
}

export interface DashboardKpiBucket {
  /** Bucket start (ISO, UTC). */
  bucket: string
  requests: number
  errors: number
  tokens: number
  cost_usd: number
  latency_p95_ms: number
}

export interface DashboardKpis {
  current: DashboardKpiTotals
  /** Same keys for the equal-length window just before `from`. */
  previous: DashboardKpiTotals
  granularity: 'hour' | 'day'
  /** Gap-free series for the current window (empty buckets are zeros). */
  series: DashboardKpiBucket[]
}

/** Dashboard KPIs (request_logs) for [from, to) plus the previous window, scoped like /dashboard/stats. */
export function useDashboardKpis(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['dashboard-kpis', from, to],
    queryFn: () =>
      apiClient<DashboardKpis>(`/dashboard/kpis?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: enabled && !!from && !!to,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
