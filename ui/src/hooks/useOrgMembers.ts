import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

// OrgMembershipResponse is the wire shape returned by GET/POST /orgs/:id/members.
export interface OrgMembershipResponse {
  id: string
  org_id: string
  user_id: string
  role: string
  created_at: string
}

interface PaginatedOrgMemberships {
  data: OrgMembershipResponse[]
  has_more: boolean
  next_cursor?: string
}

export interface CreateOrgMemberParams {
  user_id: string
  role: string
}

export interface UpdateOrgMemberParams {
  role: string
}

export function useOrgMembers(orgId: string, cursor?: string) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return useQuery({
    queryKey: ['org-members', orgId, cursor],
    queryFn: () =>
      apiClient<PaginatedOrgMemberships>(`/orgs/${orgId}/members?${params}`),
    enabled: !!orgId,
  })
}

export function useCreateOrgMember(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: CreateOrgMemberParams) =>
      apiClient<OrgMembershipResponse>(`/orgs/${orgId}/members`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
  })
}

export function useUpdateOrgMember(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      membershipId,
      params,
    }: {
      membershipId: string
      params: UpdateOrgMemberParams
    }) =>
      apiClient<OrgMembershipResponse>(
        `/orgs/${orgId}/members/${membershipId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(params),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
    },
  })
}

export function useDeleteOrgMember(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (membershipId: string) =>
      apiClient<void>(`/orgs/${orgId}/members/${membershipId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
  })
}

export interface OrgMemberOption {
  userId: string
  label: string
  description: string
}

/**
 * Org members resolved to name/email, for pickers (e.g. adding a team member:
 * team members must already belong to the org). Excludes `excludeUserIds`.
 */
export function useOrgMemberOptions(orgId: string, excludeUserIds: ReadonlySet<string>) {
  return useQuery({
    queryKey: ['org-member-options', orgId],
    queryFn: async (): Promise<OrgMemberOption[]> => {
      const membersRes = await apiClient<{ data: OrgMembershipResponse[] }>(
        `/orgs/${orgId}/members?limit=200`,
      )
      return Promise.all(
        membersRes.data.map(async (m) => {
          try {
            const user = await apiClient<{ display_name: string; email: string }>(`/users/${m.user_id}`)
            return { userId: m.user_id, label: user.display_name, description: user.email }
          } catch {
            return { userId: m.user_id, label: m.user_id, description: '' }
          }
        }),
      )
    },
    select: (options) => options.filter((u) => !excludeUserIds.has(u.userId)),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}
