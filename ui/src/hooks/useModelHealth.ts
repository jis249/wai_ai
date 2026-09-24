import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

export type CircuitState = 'closed' | 'open' | 'half_open'

/** Circuit breaker state of one upstream deployment (from the proxy, in memory). */
export interface DeploymentCircuitInfo {
  id: string
  name: string
  circuit: CircuitState
  consecutive_failures: number
  /** ISO timestamp the open circuit is paused until, or empty. */
  cooldown_until: string
  inflight: number
}

export interface ModelHealthInfo {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  latency_ms: number
  last_check: string
  last_error?: string
  health_ok: boolean | null
  models_ok: boolean | null
  functional_ok: boolean | null
  deployments?: DeploymentCircuitInfo[]
}

interface ModelHealthResponse {
  models: ModelHealthInfo[]
}

export function useModelHealth() {
  return useQuery({
    queryKey: ['model-health'],
    queryFn: () => apiClient<ModelHealthResponse>('/models/health'),
    refetchInterval: 15_000, // refresh every 15s for near-realtime health
  })
}
