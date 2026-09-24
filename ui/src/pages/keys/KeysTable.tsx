import React from 'react'
import { Table } from '../../components/ui/Table'
import type { Column, PaginationState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { KeyHint } from '../../components/ui/KeyHint'
import { TimeAgo } from '../../components/ui/TimeAgo'
import { IconButton } from '../../components/ui/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu'
import { Copy, Ellipsis, Pencil, RefreshCw, Trash2 } from '../../components/ui/icons'
import type { APIKeyResponse } from '../../hooks/useAPIKeys'
import {
  keyActions,
  keyOwnerLabel,
  keyStatus,
  keyStatusBadgeVariant,
  keyStatusLabels,
  keyTypeBadgeVariant,
  keyTypeLabels,
} from './helpers'
import type { KeySort, KeySortColumn, OwnerContext } from './helpers'

interface KeysTableProps {
  rows: APIKeyResponse[]
  loading: boolean
  now: number
  owner: OwnerContext
  canManageAnyKey: boolean
  sort: KeySort | null
  onSort: (column: KeySortColumn) => void
  busy?: boolean
  onEdit: (key: APIKeyResponse) => void
  onRotate: (key: APIKeyResponse) => void
  onRevoke: (key: APIKeyResponse) => void
  pagination?: PaginationState
  emptyState?: React.ReactNode
}

export function KeysTable({
  rows,
  loading,
  now,
  owner,
  canManageAnyKey,
  sort,
  onSort,
  busy = false,
  onEdit,
  onRotate,
  onRevoke,
  pagination,
  emptyState,
}: KeysTableProps) {
  const columns: Column<APIKeyResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <div className="min-w-0 max-w-[16rem]">
          <p className="truncate font-medium text-text-primary">{row.name}</p>
          <span className="font-mono text-xs text-text-tertiary">
            <KeyHint hint={row.key_hint} />
          </span>
        </div>
      ),
    },
    {
      key: 'key_type',
      header: 'Type',
      sortable: true,
      render: (row) => (
        <Badge variant={keyTypeBadgeVariant[row.key_type] ?? 'muted'}>{keyTypeLabels[row.key_type] ?? row.key_type}</Badge>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      sortable: true,
      render: (row) => (
        <span className="block max-w-[12rem] truncate text-text-secondary">{keyOwnerLabel(row, owner)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => {
        const status = keyStatus(row, now)
        return <Badge variant={keyStatusBadgeVariant[status]}>{keyStatusLabels[status]}</Badge>
      },
    },
    {
      key: 'expires_at',
      header: 'Expires',
      sortable: true,
      render: (row) => <TimeAgo date={row.expires_at ?? ''} fallback="Never" />,
    },
    {
      key: 'last_used_at',
      header: 'Last used',
      sortable: true,
      render: (row) => <TimeAgo date={row.last_used_at ?? ''} fallback="Never" />,
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row) => <TimeAgo date={row.created_at} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const actions = keyActions(row, { meId: owner.meId, canManageAnyKey })
        if (!actions.canEdit && !actions.canRotate && !actions.canRevoke) return null
        const isSession = row.key_type === 'session_key'
        return (
          <div className="flex items-center justify-end gap-0.5">
            {actions.canEdit && (
              <IconButton
                size="sm"
                icon={<Pencil />}
                aria-label={`Edit ${isSession ? 'session' : 'key'} ${row.name}`}
                tooltip={isSession ? 'Edit session' : 'Edit key'}
                onClick={() => onEdit(row)}
                disabled={busy}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={<Ellipsis />} aria-label={`More actions for ${row.name}`} tooltip="More" disabled={busy} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {actions.canRotate && (
                  <DropdownMenuItem icon={<RefreshCw />} onSelect={() => onRotate(row)}>
                    Rotate key
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  icon={<Copy />}
                  onSelect={() => {
                    void navigator.clipboard?.writeText(row.id).catch(() => undefined)
                  }}
                >
                  Copy key ID
                </DropdownMenuItem>
                {actions.canRevoke && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive icon={<Trash2 />} onSelect={() => onRevoke(row)}>
                      {isSession ? 'Revoke session' : 'Revoke key'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

  return (
    <Table<APIKeyResponse>
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      loading={loading}
      sort={sort ?? undefined}
      onSort={(col) => onSort(col as KeySortColumn)}
      emptyMessage="No API keys found"
      emptyState={emptyState}
      pagination={pagination}
    />
  )
}
