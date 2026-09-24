import React from 'react'
import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Toggle } from '../../components/ui/Toggle'
import { Tooltip } from '../../components/ui/Tooltip'
import { IconButton } from '../../components/ui/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu'
import { Ellipsis, Pencil, Plug, Trash2 } from '../../components/ui/icons'
import { useTestMCPServer, useToggleMCPServer, useUpdateMCPServer } from '../../hooks/useMCPServers'
import type { MCPServerResponse } from '../../hooks/useMCPServers'
import type { MCPServerHealth } from '../../hooks/useMCPServerHealth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { HealthIndicator } from './HealthIndicator'
import { ServerExpandedRow } from './ServerExpandedRow'
import {
  authBadgeVariant,
  authLabel,
  getMCPServerDisplayUrl,
  isConfigManaged,
  scopeBadgeVariant,
  scopeLabel,
  sourceBadgeVariant,
  sourceLabel,
} from './helpers'
import type { ServerSort, ServerSortColumn } from './helpers'

interface ServersTableProps {
  servers: MCPServerResponse[]
  health: Map<string, MCPServerHealth>
  loading: boolean
  sort: ServerSort | null
  onSort: (column: ServerSortColumn) => void
  canWrite: (server: MCPServerResponse) => boolean
  expandedKeys: Set<string>
  onToggleExpand: (key: string) => void
  onEdit: (server: MCPServerResponse) => void
  onDelete: (server: MCPServerResponse) => void
  emptyState: React.ReactNode
}

export function ServersTable({
  servers,
  health,
  loading,
  sort,
  onSort,
  canWrite,
  expandedKeys,
  onToggleExpand,
  onEdit,
  onDelete,
  emptyState,
}: ServersTableProps) {
  const toggleServer = useToggleMCPServer()
  const updateServer = useUpdateMCPServer()
  const testServer = useTestMCPServer()
  const { toast, update } = useToast()

  function handleTest(row: MCPServerResponse) {
    const tid = toast({ variant: 'info', message: `Testing connection to ${row.name}...`, duration: 60000 })
    testServer.mutate(row.id, {
      onSuccess: (result) => {
        if (result.success) {
          const toolCount = result.tools != null ? ` (${result.tools} tools)` : ''
          update(tid, { variant: 'success', message: `Connection successful${toolCount}` })
        } else {
          update(tid, { variant: 'error', message: result.error ?? 'Connection test failed' })
        }
      },
      onError: (err) => update(tid, { variant: 'error', message: errorMessage(err, 'Connection test failed') }),
    })
  }

  const columns: Column<MCPServerResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => <span className="whitespace-nowrap font-mono text-sm text-text-primary">{row.name}</span>,
    },
    {
      key: 'alias',
      header: 'Alias',
      sortable: true,
      render: (row) => <Badge variant="muted">{row.alias}</Badge>,
    },
    {
      key: 'url',
      header: 'URL',
      sortable: true,
      render: (row) => {
        const url = getMCPServerDisplayUrl(row)
        return (
          <Tooltip content={url || null}>
            <span className="block max-w-[260px] truncate text-sm text-text-tertiary" tabIndex={url ? 0 : undefined}>
              {url || '—'}
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'auth_type',
      header: 'Auth',
      render: (row) => <Badge variant={authBadgeVariant(row.auth_type)}>{authLabel(row.auth_type)}</Badge>,
    },
    {
      key: 'scope',
      header: 'Scope',
      sortable: true,
      render: (row) => <Badge variant={scopeBadgeVariant(row.scope)}>{scopeLabel(row.scope)}</Badge>,
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) => <Badge variant={sourceBadgeVariant(row.source)}>{sourceLabel(row.source)}</Badge>,
    },
    {
      key: 'tools',
      header: 'Tools',
      sortable: true,
      align: 'right',
      render: (row) => {
        const count = health.get(row.id)?.tool_count
        return <span className="text-sm tabular-nums text-text-secondary">{count === undefined ? '—' : count}</span>
      },
    },
    {
      key: 'is_active',
      header: 'Active',
      sortable: true,
      render: (row) => {
        const canToggle = !isConfigManaged(row) && canWrite(row)
        return (
          <Toggle
            checked={row.is_active}
            aria-label={`${row.is_active ? 'Deactivate' : 'Activate'} ${row.name}`}
            onChange={(activate) =>
              toggleServer.mutate(
                { serverId: row.id, activate },
                { onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to update server status') }) },
              )
            }
            disabled={!canToggle || (toggleServer.isPending && toggleServer.variables?.serverId === row.id)}
            size="sm"
          />
        )
      },
    },
    {
      key: 'code_mode_enabled',
      header: 'Code Mode',
      render: (row) => (
        <Toggle
          checked={row.code_mode_enabled}
          aria-label={`${row.code_mode_enabled ? 'Disable' : 'Enable'} Code Mode for ${row.name}`}
          onChange={(enabled) =>
            updateServer.mutate(
              { serverId: row.id, params: { code_mode_enabled: enabled } },
              { onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to update code mode') }) },
            )
          }
          disabled={!canWrite(row) || (updateServer.isPending && updateServer.variables?.serverId === row.id)}
          size="sm"
        />
      ),
    },
    {
      key: 'health',
      header: 'Health',
      sortable: true,
      render: (row) => <HealthIndicator health={health.get(row.id)} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        if (!canWrite(row)) return null
        const editable = !isConfigManaged(row)
        const testing = testServer.isPending && testServer.variables === row.id
        return (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              aria-label={`Test connection to ${row.name}`}
              tooltip="Test connection"
              size="sm"
              icon={<Plug />}
              loading={testing}
              onClick={() => handleTest(row)}
            />
            {editable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label={`More actions for ${row.name}`} tooltip="More actions" size="sm" icon={<Ellipsis />} />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem icon={<Pencil />} onSelect={() => onEdit(row)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => onDelete(row)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <Table<MCPServerResponse>
      columns={columns}
      data={servers}
      keyExtractor={(row) => row.id}
      loading={loading}
      sort={sort ?? undefined}
      onSort={(col) => onSort(col as ServerSortColumn)}
      emptyState={emptyState}
      expandedKeys={expandedKeys}
      onToggleExpand={onToggleExpand}
      renderExpandedRow={(row) => (
        // Blocklist management is allowed regardless of source (YAML or API);
        // only RBAC matters. Config editing is still blocked for YAML/built-in.
        <ServerExpandedRow server={row} canEdit={canWrite(row)} health={health.get(row.id)} />
      )}
    />
  )
}
