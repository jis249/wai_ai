import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface DeploymentResponse {
  id: string
  model_id: string
  name: string
  provider: string
  base_url: string
  azure_deployment?: string
  azure_api_version?: string
  weight: number
  priority: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ModelResponse {
  id: string
  name: string
  type: string
  provider: string
  base_url: string
  max_context_tokens: number
  input_price_per_1m: number
  output_price_per_1m: number
  azure_deployment?: string
  azure_api_version?: string
  timeout?: string
  is_active: boolean
  source: string
  aliases: string[]
  created_at: string
  updated_at: string
  strategy?: string
  max_retries?: number
  fallback_model_name?: string
  deployments?: DeploymentResponse[]
}

interface PaginatedModels {
  data: ModelResponse[]
  has_more: boolean
  next_cursor?: string
}

export interface CreateModelParams {
  name: string
  type: string
  provider?: string
  base_url?: string
  api_key?: string
  max_context_tokens?: number
  input_price_per_1m?: number
  output_price_per_1m?: number
  azure_deployment?: string
  azure_api_version?: string
  timeout?: string
  aliases?: string[]
  strategy?: string
  max_retries?: number
  fallback_model_name?: string
}

export interface CreateDeploymentParams {
  name: string
  provider: string
  base_url: string
  api_key?: string
  azure_deployment?: string
  azure_api_version?: string
  weight?: number
  priority?: number
}

export interface UpdateDeploymentParams {
  name?: string
  provider?: string
  base_url?: string
  api_key?: string
  azure_deployment?: string
  azure_api_version?: string
  weight?: number
  priority?: number
}

export interface UpdateModelParams {
  name?: string
  type?: string
  provider?: string
  base_url?: string
  api_key?: string
  max_context_tokens?: number
  input_price_per_1m?: number
  output_price_per_1m?: number
  azure_deployment?: string
  azure_api_version?: string
  timeout?: string
  aliases?: string[]
  fallback_model_name?: string | null
}

export function useModels(cursor?: string) {
  const params = new URLSearchParams({ limit: '50', include_inactive: 'true' })
  if (cursor) params.set('cursor', cursor)
  return useQuery({
    queryKey: ['models', cursor],
    queryFn: () => apiClient<PaginatedModels>(`/models?${params}`),
  })
}

export interface AccessibleModel {
  id: string
  name: string
  type: string
  provider: string
  max_context_tokens: number
  input_price_per_1m: number
  output_price_per_1m: number
  is_active: boolean
  aliases: string[]
  strategy?: string
  fallback_model_name?: string
}

function accessibleToModelResponse(model: AccessibleModel): ModelResponse {
  return {
    id: model.id,
    name: model.name,
    type: model.type,
    provider: model.provider,
    base_url: '',
    max_context_tokens: model.max_context_tokens,
    input_price_per_1m: model.input_price_per_1m,
    output_price_per_1m: model.output_price_per_1m,
    is_active: model.is_active,
    source: 'api',
    aliases: model.aliases,
    strategy: model.strategy ?? '',
    fallback_model_name: model.fallback_model_name ?? '',
    created_at: '',
    updated_at: '',
  }
}

export function useAccessibleModels(enabled = true) {
  return useQuery({
    queryKey: ['accessible-models-detail'],
    queryFn: async () => {
      const res = await apiClient<{ data: AccessibleModel[] }>('/me/models')
      return {
        data: res.data.map(accessibleToModelResponse),
      }
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useCreateModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: CreateModelParams) =>
      apiClient<ModelResponse>('/models', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useDeleteModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string) =>
      apiClient<void>(`/models/${modelId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useUpdateModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, params }: { modelId: string; params: UpdateModelParams }) =>
      apiClient<ModelResponse>(`/models/${modelId}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useToggleModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, activate }: { modelId: string; activate: boolean }) =>
      apiClient<ModelResponse>(`/models/${modelId}/${activate ? 'activate' : 'deactivate'}`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useCreateDeployment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, params }: { modelId: string; params: CreateDeploymentParams }) =>
      apiClient<DeploymentResponse>(`/models/${modelId}/deployments`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useUpdateDeployment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, deploymentId, params }: { modelId: string; deploymentId: string; params: UpdateDeploymentParams }) =>
      apiClient<DeploymentResponse>(`/models/${modelId}/deployments/${deploymentId}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useDeleteDeployment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, deploymentId }: { modelId: string; deploymentId: string }) =>
      apiClient<void>(`/models/${modelId}/deployments/${deploymentId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}
