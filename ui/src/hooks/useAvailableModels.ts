import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

/** One entry of GET /me/available-models (backend `AvailableModel`). */
export interface AvailableModel {
  name: string
  type: string
}

interface AvailableModelsWire {
  // Backend returns objects; older builds returned bare names. Accept both.
  models: (AvailableModel | string)[]
}

export interface AvailableModelsResponse {
  models: AvailableModel[]
}

function normalize(raw: AvailableModelsWire | null | undefined): AvailableModelsResponse {
  const models = (raw?.models ?? []).map((m) =>
    typeof m === 'string' ? { name: m, type: 'chat' } : { name: m.name, type: m.type || 'chat' },
  )
  return { models }
}

/**
 * Models the signed-in user may call. Shared cache key `['available-models']`
 * (ModelsAccessTab invalidates it after access changes).
 */
export function useAvailableModels(options: { alwaysFresh?: boolean } = {}) {
  return useQuery({
    queryKey: ['available-models'],
    queryFn: async () => normalize(await apiClient<AvailableModelsWire>('/me/available-models')),
    ...(options.alwaysFresh ? { staleTime: 0, refetchOnMount: 'always' as const } : {}),
  })
}
