import { useMe } from '../hooks/useMe'
import { usePermissions } from '../hooks/usePermissions'
import { useOrgMCPAccess, useSetOrgMCPAccess, useAvailableGlobalMCPServers } from '../hooks/useMCPAccess'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { StatCard } from '../components/ui/StatCard'
import { ErrorState } from '../components/ui/ErrorState'
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton'
import { Globe, ShieldCheck } from '../components/ui/icons'
import { ServerAccessChecklist } from './mcp/ServerAccessChecklist'

export default function MCPAccessTab() {
  const { data: me } = useMe()
  const { canManageOrg, isReady } = usePermissions()
  const orgId = me?.org_id ?? ''

  const serversQuery = useAvailableGlobalMCPServers(orgId)
  const accessQuery = useOrgMCPAccess(orgId)
  const setAccess = useSetOrgMCPAccess(orgId)
  const { toast } = useToast()

  const failed = [serversQuery, accessQuery].find((q) => q.isError && q.data === undefined)
  const isLoading =
    !isReady || [serversQuery, accessQuery].some((q) => q.isPending && q.fetchStatus !== 'idle')
  const servers = serversQuery.data ?? []
  const saved = accessQuery.data?.servers ?? []

  async function handleSave(ids: string[]) {
    try {
      await setAccess.mutateAsync(ids)
      toast({ variant: 'success', message: 'MCP access updated' })
    } catch (err) {
      toast({ variant: 'error', message: errorMessage(err, 'Failed to update MCP access') })
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
          label="Available global servers"
          value={isLoading ? '—' : servers.length}
          iconColor="blue"
          icon={<Globe className="w-4 h-4" />}
        />
      </div>

      <div>
        <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">MCP server allowlist</h3>
        <p className="text-sm text-text-secondary">
          Choose which <strong className="font-medium">global</strong> MCP servers this organization can use. An{' '}
          <strong className="font-medium">empty list means all global servers are allowed</strong>; selecting servers
          narrows access to just those. Team and API-key lists can only narrow this further. Org- and team-scoped
          servers are not affected.
        </p>
      </div>

      {!orgId && !isLoading ? (
        <p className="text-sm text-text-tertiary">You are not a member of an organization.</p>
      ) : failed ? (
        <ErrorState
          variant="card"
          title="Couldn't load MCP access"
          error={failed.error}
          onRetry={() => {
            void serversQuery.refetch()
            void accessQuery.refetch()
          }}
          retrying={serversQuery.isFetching || accessQuery.isFetching}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <SkeletonRows rows={4} columns={2} />
        </div>
      ) : (
        <ServerAccessChecklist
          servers={servers}
          saved={saved}
          onSave={handleSave}
          saving={setAccess.isPending}
          readOnly={!canManageOrg}
          subject="this organization"
          unrestrictedText={`No restriction: all ${servers.length} global server${servers.length === 1 ? ' is' : 's are'} allowed for this organization.`}
        />
      )}
    </div>
  )
}
