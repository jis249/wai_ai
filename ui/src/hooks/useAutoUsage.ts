import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface AutoRoutingUsageRow {
  org_id: string
  org_label: string
  user_id: string
  user_label: string
  routed_model: string
  total_requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_estimate: number
}

export interface AutoRoutingModelUsage {
  routed_model: string
  total_requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_estimate: number
}

export interface AutoRoutingUsageResponse {
  org_id: string
  from: string
  to: string
  default_model: string
  total_requests: number
  total_tokens: number
  cost_estimate: number
  by_user_model: AutoRoutingUsageRow[]
  by_model: AutoRoutingModelUsage[]
}

export function useMyAutoUsage(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['auto-usage', 'me', from, to],
    queryFn: () =>
      apiClient<AutoRoutingUsageResponse>(
        `/usage/me/auto?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: enabled && !!from && !!to,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useOrgAutoUsage(orgId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['auto-usage', orgId, from, to],
    queryFn: () =>
      apiClient<AutoRoutingUsageResponse>(
        `/orgs/${orgId}/usage/auto?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: enabled && !!orgId && !!from && !!to,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useCrossOrgAutoUsage(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['auto-usage', 'cross-org', from, to],
    queryFn: () =>
      apiClient<AutoRoutingUsageResponse>(
        `/usage/auto?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: enabled && !!from && !!to,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
