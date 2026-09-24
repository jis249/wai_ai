import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface MCPServerResponse {
  id: string
  name: string
  alias: string
  url: string
  auth_type: string
  auth_header?: string
  oauth_token_url?: string
  oauth_client_id?: string
  oauth_scopes?: string
  // Note: oauth_client_secret is write-only, never returned
  /** source is "api" for Admin API-created servers and "yaml" for config-file-sourced servers. */
  source: string
  scope: string
  org_id?: string
  team_id?: string
  is_active: boolean
  code_mode_enabled: boolean
  created_at: string
  updated_at: string
}

export interface CreateMCPServerParams {
  name: string
  alias: string
  url: string
  auth_type: string
  auth_header?: string
  auth_token?: string
  oauth_token_url?: string
  oauth_client_id?: string
  oauth_client_secret?: string
  oauth_scopes?: string
}

export interface UpdateMCPServerParams {
  name?: string
  alias?: string
  url?: string
  auth_type?: string
  auth_header?: string
  auth_token?: string
  oauth_token_url?: string
  oauth_client_id?: string
  oauth_client_secret?: string
  oauth_scopes?: string
  code_mode_enabled?: boolean
}

export interface ToolBlocklistEntry {
  id: string
  server_id: string
  tool_name: string
  reason: string
  created_by: string | null
  created_at: string
}

export interface RefreshToolsResponse {
  tool_count: number
}

export interface TestMCPServerResponse {
  success: boolean
  tools?: number
  error?: string
}

export function useMCPServers() {
  return useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => apiClient<MCPServerResponse[]>('/mcp-servers'),
  })
}

export function useOrgMCPServers(orgId: string) {
  return useQuery({
    queryKey: ['mcp-servers', 'org', orgId],
    queryFn: () => apiClient<MCPServerResponse[]>(`/orgs/${orgId}/mcp-servers`),
    enabled: !!orgId,
  })
}

export function useUpdateMCPServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, params }: { serverId: string; params: UpdateMCPServerParams }) =>
      apiClient<MCPServerResponse>(`/mcp-servers/${serverId}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })
}

export function useDeleteMCPServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) =>
      apiClient<void>(`/mcp-servers/${serverId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })
}

export function useToggleMCPServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, activate }: { serverId: string; activate: boolean }) =>
      apiClient<MCPServerResponse>(`/mcp-servers/${serverId}/${activate ? 'activate' : 'deactivate'}`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })
}

export function useTestMCPServer() {
  return useMutation({
    mutationFn: (serverId: string) =>
      apiClient<TestMCPServerResponse>(`/mcp-servers/${serverId}/test`, { method: 'POST' }),
  })
}

export function useMCPServerBlocklist(serverId: string) {
  return useQuery<ToolBlocklistEntry[]>({
    queryKey: ['mcp-server-blocklist', serverId],
    queryFn: () => apiClient<ToolBlocklistEntry[]>(`/mcp-servers/${serverId}/blocklist`),
    enabled: !!serverId,
  })
}

export function useAddBlocklistEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, toolName, reason }: { serverId: string; toolName: string; reason?: string }) =>
      apiClient<ToolBlocklistEntry>(`/mcp-servers/${serverId}/blocklist`, {
        method: 'POST',
        body: JSON.stringify({ tool_name: toolName, reason: reason ?? '' }),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-server-blocklist', vars.serverId] })
      queryClient.invalidateQueries({ queryKey: ['mcp-server-tools', vars.serverId] })
    },
  })
}

export function useRemoveBlocklistEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, toolName }: { serverId: string; toolName: string }) =>
      apiClient<void>(`/mcp-servers/${serverId}/blocklist?tool_name=${encodeURIComponent(toolName)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-server-blocklist', vars.serverId] })
      queryClient.invalidateQueries({ queryKey: ['mcp-server-tools', vars.serverId] })
    },
  })
}

export function useRefreshMCPServerTools() {
  const queryClient = useQueryClient()
  return useMutation<RefreshToolsResponse, Error, string>({
    mutationFn: (serverId: string) =>
      apiClient<RefreshToolsResponse>(`/mcp-servers/${serverId}/refresh-tools`, { method: 'POST' }),
    onSuccess: (_, serverId) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-server-blocklist'] })
      queryClient.invalidateQueries({ queryKey: ['mcp-server-tools', serverId] })
    },
  })
}

export interface MCPToolResponse {
  name: string
  description: string
  blocked: boolean
}

export function useMCPServerTools(serverId: string) {
  return useQuery<MCPToolResponse[]>({
    queryKey: ['mcp-server-tools', serverId],
    queryFn: () => apiClient<MCPToolResponse[]>(`/mcp-servers/${serverId}/tools`),
    enabled: !!serverId,
  })
}

export interface SetToolBlockedVars {
  toolName: string
  blocked: boolean
}

export const toolBlockMutationKey = (serverId: string) => ['mcp-tool-block', serverId] as const

/**
 * Block / unblock one tool with an optimistic update of the cached tools list.
 * Same requests as useAddBlocklistEntry / useRemoveBlocklistEntry. On error only the
 * affected tool is rolled back, so concurrent toggles on other tools are preserved.
 */
export function useSetToolBlocked(serverId: string) {
  const queryClient = useQueryClient()
  const toolsKey = ['mcp-server-tools', serverId]
  const setBlocked = (toolName: string, blocked: boolean) =>
    queryClient.setQueryData<MCPToolResponse[]>(toolsKey, (old) =>
      old?.map((t) => (t.name === toolName ? { ...t, blocked } : t)),
    )
  return useMutation<unknown, Error, SetToolBlockedVars, { previous: boolean | undefined }>({
    mutationKey: toolBlockMutationKey(serverId),
    mutationFn: ({ toolName, blocked }) =>
      blocked
        ? apiClient<ToolBlocklistEntry>(`/mcp-servers/${serverId}/blocklist`, {
            method: 'POST',
            body: JSON.stringify({ tool_name: toolName, reason: '' }),
          })
        : apiClient<void>(`/mcp-servers/${serverId}/blocklist?tool_name=${encodeURIComponent(toolName)}`, {
            method: 'DELETE',
          }),
    onMutate: async ({ toolName, blocked }) => {
      await queryClient.cancelQueries({ queryKey: toolsKey })
      const previous = queryClient
        .getQueryData<MCPToolResponse[]>(toolsKey)
        ?.find((t) => t.name === toolName)?.blocked
      setBlocked(toolName, blocked)
      return { previous }
    },
    onError: (_err, { toolName }, context) => {
      if (context?.previous !== undefined) setBlocked(toolName, context.previous)
    },
    onSettled: () => {
      // Refetch once the last in-flight toggle settles so a refetch can't clobber
      // another optimistic change (this mutation still counts while settling).
      if (queryClient.isMutating({ mutationKey: toolBlockMutationKey(serverId) }) > 1) return
      queryClient.invalidateQueries({ queryKey: ['mcp-server-blocklist', serverId] })
      queryClient.invalidateQueries({ queryKey: toolsKey })
    },
  })
}
