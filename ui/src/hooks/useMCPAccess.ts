import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

export interface AvailableMCPServer {
  id: string
  name: string
  alias: string
}

export function useAvailableGlobalMCPServers(orgId: string) {
  return useQuery({
    queryKey: ['available-mcp-servers', orgId],
    queryFn: () =>
      apiClient<AvailableMCPServer[]>(`/orgs/${orgId}/available-mcp-servers`),
    enabled: !!orgId,
  })
}

// The API speaks `server_ids`; pages consume `{ servers }`.
interface MCPAccessWire {
  server_ids: string[]
}

async function fetchAccess(path: string): Promise<{ servers: string[] }> {
  const res = await apiClient<MCPAccessWire>(path)
  return { servers: res.server_ids ?? [] }
}

async function putAccess(path: string, servers: string[]): Promise<{ servers: string[] }> {
  const res = await apiClient<MCPAccessWire>(path, {
    method: 'PUT',
    body: JSON.stringify({ server_ids: servers }),
  })
  return { servers: res.server_ids ?? [] }
}

export function useOrgMCPAccess(orgId: string) {
  return useQuery({
    queryKey: ['mcp-access', 'org', orgId],
    queryFn: () => fetchAccess(`/orgs/${orgId}/mcp-access`),
    enabled: !!orgId,
  })
}

export function useSetOrgMCPAccess(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (servers: string[]) => putAccess(`/orgs/${orgId}/mcp-access`, servers),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['mcp-access', 'org', orgId],
      })
    },
  })
}

export function useTeamMCPAccess(orgId: string, teamId: string) {
  return useQuery({
    queryKey: ['mcp-access', 'team', orgId, teamId],
    queryFn: () => fetchAccess(`/orgs/${orgId}/teams/${teamId}/mcp-access`),
    enabled: !!orgId && !!teamId,
  })
}

export function useSetTeamMCPAccess(orgId: string, teamId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (servers: string[]) =>
      putAccess(`/orgs/${orgId}/teams/${teamId}/mcp-access`, servers),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['mcp-access', 'team', orgId, teamId],
      })
    },
  })
}
