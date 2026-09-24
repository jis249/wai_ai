import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

/** GET /onboarding/status — setup progress for the caller's org (system admin: their own org). */
export interface OnboardingStatus {
  has_models: boolean
  has_keys: boolean
  has_requests: boolean
  has_budget: boolean
  has_members: boolean
}

export function useOnboardingStatus(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => apiClient<OnboardingStatus>('/onboarding/status'),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  })
}
