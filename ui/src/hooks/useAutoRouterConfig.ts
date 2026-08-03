import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

export type ComplexMode = 'random' | 'fixed'

export interface AutoRouterConfig {
  enabled: boolean
  default_model: string
  classifier_model: string
  classifier_timeout_seconds: number
  complex_mode: ComplexMode
  complex_model: string
}

export type AutoRouterConfigUpdate = Partial<AutoRouterConfig>

export function useAutoRouterConfig(enabled = true) {
  return useQuery({
    queryKey: ['auto-router-config'],
    queryFn: () => apiClient<AutoRouterConfig>('/settings/auto-router'),
    staleTime: 30_000,
    enabled,
  })
}

export function useUpdateAutoRouterConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AutoRouterConfigUpdate) =>
      apiClient<AutoRouterConfig>('/settings/auto-router', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['auto-router-config'], data)
    },
  })
}
