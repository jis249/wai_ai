import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface RequestLogRow {
  id: string
  created_at: string
  status: number
  model: string
  routed_model: string
  key_hint: string
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  latency_ms: number
  cache_hit: boolean
}

interface PaginatedLogs {
  data: RequestLogRow[]
  has_more: boolean
}

export function useRequestLogs() {
  return useQuery({
    queryKey: ['request-logs'],
    queryFn: () => apiClient<PaginatedLogs>('/usage/request-logs?limit=50'),
  })
}
