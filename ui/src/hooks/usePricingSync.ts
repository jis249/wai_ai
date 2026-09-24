import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

export type PricingAction = 'update' | 'unchanged' | 'no_match' | 'manual_locked'
export type PricingSource = 'manual' | 'synced'

export interface PricingPreviewRow {
  model_id: string
  name: string
  provider: string
  model_source: string
  pricing_source: PricingSource
  pricing_key: string
  pricing_synced_at: string
  current_input_per_1m: number
  current_output_per_1m: number
  current_context_window: number
  match_key: string
  matched_via: string
  catalog_input_per_1m: number | null
  catalog_output_per_1m: number | null
  catalog_context_window: number
  input_diff: number
  output_diff: number
  action: PricingAction
  note: string
}

export interface PricingPreview {
  source: string
  fetched_at: string
  entries: number
  counts: Record<PricingAction, number>
  rows: PricingPreviewRow[]
}

export interface PricingStatus {
  source: string
  source_kind: 'url' | 'file'
  auto_sync: boolean
  auto_sync_interval_hours: number
  last_fetch_at: string
  last_sync_at: string
  last_auto_sync_at: string
  entries: number
  counts: Record<PricingAction, number>
  synced_models: number
  last_error: string
  last_error_at: string
}

export interface PricingChange {
  model_id: string
  name: string
  match_key: string
  old_input_per_1m: number
  old_output_per_1m: number
  new_input_per_1m: number | null
  new_output_per_1m: number | null
  pricing_source: PricingSource
  prices_changed: boolean
}

export interface PricingApplyResult {
  updated: PricingChange[]
  skipped: { model_id: string; name?: string; reason: string }[]
}

export interface PricingSettings {
  model_id: string
  pricing_source: PricingSource
  pricing_key: string
  pricing_synced_at: string
}

export interface PricingLookupParams {
  key?: string
  name?: string
  provider?: string
  azure_deployment?: string
  model_id?: string
}

export interface PricingLookupResult {
  found: boolean
  match_key?: string
  matched_via?: string
  has_price?: boolean
  input_per_1m?: number | null
  output_per_1m?: number | null
  context_window?: number
  litellm_provider?: string
  mode?: string
  tried: string[]
  source: string
}

const PRICING_KEY = ['pricing'] as const

export function usePricingPreview(enabled = true) {
  return useQuery({
    queryKey: [...PRICING_KEY, 'preview'],
    queryFn: () => apiClient<PricingPreview>('/pricing/preview'),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function usePricingStatus(enabled = true) {
  return useQuery({
    queryKey: [...PRICING_KEY, 'status'],
    queryFn: () => apiClient<PricingStatus>('/pricing/status'),
    enabled,
    staleTime: 30_000,
  })
}

/** Re-fetch the catalog from the source (bypasses the server's in-memory cache). */
export function useRefreshPricingPreview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient<PricingPreview>('/pricing/preview?refresh=true'),
    onSuccess: (data) => {
      queryClient.setQueryData([...PRICING_KEY, 'preview'], data)
      void queryClient.invalidateQueries({ queryKey: [...PRICING_KEY, 'status'] })
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: [...PRICING_KEY, 'status'] })
    },
  })
}

export function useApplyPricing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { model_ids: string[]; lock_to_synced?: boolean }) =>
      apiClient<PricingApplyResult>('/pricing/apply', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRICING_KEY })
      void queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function usePricingSettings(modelId: string | undefined) {
  return useQuery({
    queryKey: [...PRICING_KEY, 'settings', modelId],
    queryFn: () => apiClient<PricingSettings>(`/models/${modelId}/pricing-settings`),
    enabled: !!modelId,
  })
}

export function useUpdatePricingSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      modelId,
      params,
    }: {
      modelId: string
      params: { pricing_source?: PricingSource; pricing_key?: string }
    }) =>
      apiClient<PricingSettings>(`/models/${modelId}/pricing-settings`, {
        method: 'PUT',
        body: JSON.stringify(params),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([...PRICING_KEY, 'settings', data.model_id], data)
      void queryClient.invalidateQueries({ queryKey: [...PRICING_KEY, 'preview'] })
      void queryClient.invalidateQueries({ queryKey: [...PRICING_KEY, 'status'] })
    },
  })
}

export function usePricingLookup() {
  return useMutation({
    mutationFn: (params: PricingLookupParams) => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) qs.set(k, v)
      }
      return apiClient<PricingLookupResult>(`/pricing/lookup?${qs}`)
    },
  })
}
