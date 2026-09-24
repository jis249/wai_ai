import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'
import { PageHeader } from '../components/ui/PageHeader'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Activity, CirclePause, HeartPulse, Plus, Search, Server } from '../components/ui/icons'
import { useOrgMCPServers, useDeleteMCPServer } from '../hooks/useMCPServers'
import type { MCPServerResponse } from '../hooks/useMCPServers'
import { useMCPServerHealth } from '../hooks/useMCPServerHealth'
import { useMe } from '../hooks/useMe'
import { usePermissions } from '../hooks/usePermissions'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { ServersTable } from './mcp/ServersTable'
import { CreateServerSheet } from './mcp/CreateServerSheet'
import { DeepLinkParam } from '../components/onboarding/DeepLinkParam'
import { EditServerSheet } from './mcp/EditServerSheet'
import { canWriteServer, filterServers, nextSort, sortServers } from './mcp/helpers'
import type { ServerSort } from './mcp/helpers'

export default function MCPServersPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const [showCreate, setShowCreate] = useState(false)
  const [editServer, setEditServer] = useState<MCPServerResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MCPServerResponse | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ServerSort | null>(null)

  const { data: me } = useMe()
  const perms = usePermissions()
  const orgId = me?.org_id ?? ''
  const { isSystemAdmin, isOrgAdmin, isTeamAdmin } = perms
  const canCreate = isTeamAdmin

  // System admins without an org use the global list; everyone else uses the org-scoped
  // list which returns global + org + team servers visible to the caller.
  const useGlobal = isSystemAdmin && !orgId
  const globalQuery = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => apiClient<MCPServerResponse[]>('/mcp-servers'),
    enabled: useGlobal,
  })
  const orgQuery = useOrgMCPServers(orgId)
  const serversQuery = useGlobal ? globalQuery : orgQuery
  const isLoading = !perms.isReady || (serversQuery.isPending && serversQuery.fetchStatus !== 'idle')

  const deleteServer = useDeleteMCPServer()
  const { toast } = useToast()

  const { data: healthData } = useMCPServerHealth()
  const healthMap = useMemo(() => new Map((healthData ?? []).map((h) => [h.server_id, h])), [healthData])

  const allServers = useMemo(() => serversQuery.data ?? [], [serversQuery.data])
  const visibleServers = useMemo(
    () => sortServers(filterServers(allServers, search), sort, healthMap),
    [allServers, search, sort, healthMap],
  )
  const activeCount = allServers.filter((s) => s.is_active).length
  const healthyCount = allServers.filter((s) => healthMap.get(s.id)?.status === 'healthy').length

  const canWrite = (s: MCPServerResponse) => canWriteServer(s, perms, me?.org_id)

  function handleToggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteServer.mutate(deleteTarget.id, {
      onSuccess: () => toast({ variant: 'success', message: 'MCP server deleted' }),
      onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to delete MCP server') }),
      onSettled: () => setDeleteTarget(null),
    })
  }

  const addButton = canCreate ? (
    <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
      Add server
    </Button>
  ) : undefined

  const emptyState = search.trim() ? (
    <EmptyState
      icon={<Search className="w-6 h-6" />}
      title="No matching servers"
      description={`No server name, alias or URL matches “${search.trim()}”.`}
      action={{ label: 'Clear search', onClick: () => setSearch('') }}
    />
  ) : (
    <EmptyState
      icon={<Server className="w-6 h-6" />}
      title="No MCP servers yet"
      description="Register an MCP server to expose its tools through WAI."
      action={canCreate ? { label: 'Add server', onClick: () => setShowCreate(true) } : undefined}
    />
  )

  return (
    <>
      {!hideHeader && (
        <PageHeader title="MCP Servers" description="Manage Model Context Protocol server connections" actions={addButton} />
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total servers" value={isLoading ? '—' : allServers.length} icon={<Server className="w-4 h-4" />} iconColor="purple" />
        <StatCard label="Active" value={isLoading ? '—' : activeCount} icon={<Activity className="w-4 h-4" />} iconColor="green" />
        <StatCard
          label="Inactive"
          value={isLoading ? '—' : allServers.length - activeCount}
          icon={<CirclePause className="w-4 h-4" />}
          iconColor="yellow"
        />
        <StatCard
          label="Healthy"
          value={healthData === undefined ? '—' : healthyCount}
          icon={<HeartPulse className="w-4 h-4" />}
          iconColor="green"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search servers"
            placeholder="Search by name, alias or URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {hideHeader && addButton && <div className="ml-auto">{addButton}</div>}
      </div>

      {serversQuery.isError && serversQuery.data === undefined ? (
        <ErrorState
          variant="card"
          title="Couldn't load MCP servers"
          error={serversQuery.error}
          onRetry={() => void serversQuery.refetch()}
          retrying={serversQuery.isFetching}
        />
      ) : (
        <ServersTable
          servers={visibleServers}
          health={healthMap}
          loading={isLoading}
          sort={sort}
          onSort={(col) => setSort((prev) => nextSort(prev, col))}
          canWrite={canWrite}
          expandedKeys={expandedKeys}
          onToggleExpand={handleToggleExpand}
          onEdit={setEditServer}
          onDelete={setDeleteTarget}
          emptyState={emptyState}
        />
      )}

      {perms.isReady && canCreate && <DeepLinkParam name="new" onMatch={() => setShowCreate(true)} />}
      {showCreate && (
        <CreateServerSheet
          open={showCreate}
          onClose={() => setShowCreate(false)}
          orgId={orgId}
          isSystemAdmin={isSystemAdmin}
          isOrgAdmin={isOrgAdmin}
        />
      )}

      {editServer !== null && <EditServerSheet server={editServer} onClose={() => setEditServer(null)} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete MCP server"
        description={`"${deleteTarget?.name ?? ''}" will be permanently removed. Any integrations using this server will stop working.`}
        confirmLabel="Delete"
        loading={deleteServer.isPending}
      />
    </>
  )
}
