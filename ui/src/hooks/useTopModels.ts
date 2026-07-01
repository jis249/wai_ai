import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface UsageDataPoint {
  group_key: string
  total_requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_estimate: number
  avg_duration_ms: number
}

interface UsageResponse {
  org_id: string
  from: string
  to: string
  group_by: string
  data: UsageDataPoint[]
}

export function useTopModels(orgId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['top-models', orgId, from, to],
    queryFn: () =>
      apiClient<UsageResponse>(
        `/orgs/${orgId}/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&group_by=model`,
      ),
    enabled: !!orgId && !!from && !!to && enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
