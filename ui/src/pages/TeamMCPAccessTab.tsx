import { useMemo } from 'react'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { useParams } from 'react-router-dom'
import { usePermissions } from '../hooks/usePermissions'
import {
  useTeamMCPAccess,
  useSetTeamMCPAccess,
  useOrgMCPAccess,
  useAvailableGlobalMCPServers,
} from '../hooks/useMCPAccess'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { StatCard } from '../components/ui/StatCard'
import { ErrorState } from '../components/ui/ErrorState'
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton'
import { Globe, ShieldCheck } from '../components/ui/icons'
import { ServerAccessChecklist } from './mcp/ServerAccessChecklist'

export default function TeamMCPAccessTab({ teamId: teamIdProp }: { teamId?: string }) {
  const { teamId: paramTeamId = '' } = useParams<{ teamId: string }>()
  const teamId = teamIdProp || paramTeamId
  const { isTeamAdmin, isReady } = usePermissions()
  const orgId = useActiveOrgId()

  const serversQuery = useAvailableGlobalMCPServers(orgId)
  const orgAccessQuery = useOrgMCPAccess(orgId)
  const teamAccessQuery = useTeamMCPAccess(orgId, teamId)
  const setAccess = useSetTeamMCPAccess(orgId, teamId)
  const { toast } = useToast()

  const queries = [serversQuery, orgAccessQuery, teamAccessQuery]
  const failed = queries.find((q) => q.isError && q.data === undefined)
  const isLoading = !isReady || queries.some((q) => q.isPending && q.fetchStatus !== 'idle')

  // A team can only narrow what the org allows. An empty org list = all global servers.
  const orgAllowed = orgAccessQuery.data?.servers
  const eligible = useMemo(() => {
    const all = serversQuery.data ?? []
    if (!orgAllowed || orgAllowed.length === 0) return all
    const allowed = new Set(orgAllowed)
    return all.filter((s) => allowed.has(s.id))
  }, [serversQuery.data, orgAllowed])
  const saved = teamAccessQuery.data?.servers ?? []
  const orgRestricted = (orgAllowed?.length ?? 0) > 0

  async function handleSave(ids: string[]) {
    try {
      await setAccess.mutateAsync(ids)
      toast({ variant: 'success', message: 'Team MCP access updated' })
    } catch (err) {
      toast({ variant: 'error', message: errorMessage(err, 'Failed to update team MCP access') })
      throw err
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Allowed servers"
          value={isLoading ? '—' : saved.length === 0 ? 'All' : saved.length}
          iconColor="purple"
          icon={<ShieldCheck className="w-4 h-4" />}
        />
        <StatCard
          label="Org-allowed global servers"
          value={isLoading ? '—' : eligible.length}
          iconColor="blue"
          icon={<Globe className="w-4 h-4" />}
        />
      </div>

      <div>
        <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">MCP server allowlist</h3>
        <p className="text-sm text-text-secondary">
          Narrow which <strong className="font-medium">global</strong> MCP servers this team can use. An{' '}
          <strong className="font-medium">empty list means no team restriction</strong>: the team gets every global
          server the organization allows. Team lists (and API-key lists) can only narrow global servers — they never
          grant a server the organization has excluded.
          {orgRestricted && ' Only servers on the organization allowlist are shown.'}
        </p>
      </div>

      {!teamId || (!orgId && !isLoading) ? (
        <p className="text-sm text-text-tertiary">No team selected.</p>
      ) : failed ? (
        <ErrorState
          variant="card"
          title="Couldn't load team MCP access"
          error={failed.error}
          onRetry={() => queries.forEach((q) => void q.refetch())}
          retrying={queries.some((q) => q.isFetching)}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <SkeletonRows rows={4} columns={2} />
        </div>
      ) : (
        <ServerAccessChecklist
          servers={eligible}
          saved={saved}
          onSave={handleSave}
          saving={setAccess.isPending}
          readOnly={!isTeamAdmin}
          subject="this team"
          unrestrictedText={`No team restriction: all ${eligible.length} org-allowed global server${eligible.length === 1 ? ' is' : 's are'} available to this team.`}
        />
      )}
    </div>
  )
}
