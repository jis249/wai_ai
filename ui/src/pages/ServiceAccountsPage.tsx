import React, { useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Table } from '../components/ui/Table'
import type { Column, SortState } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { TimeAgo } from '../components/ui/TimeAgo'
import { StatCard } from '../components/ui/StatCard'
import { IconButton } from '../components/ui/IconButton'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Bot, Building2, Info, Pencil, Plus, Search, Trash2, Users } from '../components/ui/icons'
import { useMe } from '../hooks/useMe'
import { useServiceAccounts, useDeleteServiceAccount } from '../hooks/useServiceAccounts'
import type { ServiceAccountResponse } from '../hooks/useServiceAccounts'
import { useTeams } from '../hooks/useTeams'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { TypeToConfirmDialog } from './keys/TypeToConfirmDialog'
import { CreateServiceAccountDialog, EditServiceAccountDialog } from './keys/ServiceAccountDialogs'

// ---------------------------------------------------------------------------
// ServiceAccountsPage
// ---------------------------------------------------------------------------

type SaSortColumn = 'name' | 'scope' | 'key_count' | 'created_at'

function sortServiceAccounts(
  rows: ServiceAccountResponse[],
  sort: SortState | null,
  teamNames: Map<string, string>,
): ServiceAccountResponse[] {
  if (!sort) return rows
  const dir = sort.direction === 'asc' ? 1 : -1
  const value = (sa: ServiceAccountResponse): string | number => {
    switch (sort.column as SaSortColumn) {
      case 'scope':
        return sa.team_id ? `team ${(teamNames.get(sa.team_id) ?? '').toLowerCase()}` : 'org'
      case 'key_count':
        return sa.key_count
      case 'created_at':
        return Date.parse(sa.created_at) || 0
      default:
        return sa.name.toLowerCase()
    }
  }
  return [...rows].sort((a, b) => (value(a) < value(b) ? -dir : value(a) > value(b) ? dir : 0))
}

export default function ServiceAccountsPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { data: me } = useMe()
  const orgId = me?.org_id ?? ''

  const [cursor, setCursor] = useState<string | undefined>()
  const [prevCursors, setPrevCursors] = useState<string[]>([])
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ServiceAccountResponse | null>(null)
  const [editSa, setEditSa] = useState<ServiceAccountResponse | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState | null>(null)

  const { data: serviceAccounts, isLoading, isError, error, refetch, isFetching } = useServiceAccounts(orgId, cursor)
  const { data: teams } = useTeams(orgId)
  const deleteServiceAccount = useDeleteServiceAccount(orgId)
  const { toast } = useToast()

  const allSAs = useMemo(() => serviceAccounts?.data ?? [], [serviceAccounts?.data])
  const teamNames = useMemo(() => new Map((teams?.data ?? []).map((t) => [t.id, t.name])), [teams?.data])
  const orgScopedCount = allSAs.filter((sa) => !sa.team_id).length
  const teamScopedCount = allSAs.length - orgScopedCount

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? allSAs.filter(
          (sa) => sa.name.toLowerCase().includes(q) || (sa.team_id && teamNames.get(sa.team_id)?.toLowerCase().includes(q)),
        )
      : allSAs
    return sortServiceAccounts(filtered, sort, teamNames)
  }, [allSAs, query, sort, teamNames])

  function handleSort(column: string) {
    setSort((s) =>
      s?.column === column
        ? { column, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: column === 'created_at' || column === 'key_count' ? 'desc' : 'asc' },
    )
  }

  const columns: Column<ServiceAccountResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => <span className="block max-w-[16rem] truncate font-medium text-text-primary">{row.name}</span>,
    },
    {
      key: 'scope',
      header: 'Scope',
      sortable: true,
      render: (row) =>
        row.team_id ? (
          <Badge variant="info" className="max-w-[14rem] truncate">
            Team{teamNames.get(row.team_id) ? `: ${teamNames.get(row.team_id)}` : ''}
          </Badge>
        ) : (
          <Badge variant="default">Organization</Badge>
        ),
    },
    {
      key: 'key_count',
      header: 'Keys',
      sortable: true,
      render: (row) => <span className="text-sm text-text-secondary">{row.key_count}</span>,
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
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            size="sm"
            icon={<Pencil />}
            aria-label={`Edit ${row.name}`}
            tooltip="Edit"
            onClick={() => setEditSa(row)}
            disabled={deleteServiceAccount.isPending}
          />
          <IconButton
            size="sm"
            variant="destructive"
            icon={<Trash2 />}
            aria-label={`Delete ${row.name}`}
            tooltip="Delete"
            onClick={() => setDeleteTarget(row)}
            disabled={deleteServiceAccount.isPending}
          />
        </div>
      ),
    },
  ]

  function handleDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    deleteServiceAccount.mutate(target.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `Service account "${target.name}" deleted` })
        setDeleteTarget(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete service account') })
        setDeleteTarget(null)
      },
    })
  }

  const createButton = (
    <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setShowCreateDialog(true)}>
      Create Service Account
    </Button>
  )
  const helpText = (
    <p className="flex min-w-0 items-start gap-2 text-sm text-text-secondary">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
      <span>Service account keys work for the /v1 API and MCP gateway only.</span>
    </p>
  )

  const showEmptyState = !isLoading && !isError && allSAs.length === 0 && !serviceAccounts?.has_more && !!orgId

  let body: React.ReactNode
  if (isError && !serviceAccounts) {
    body = (
      <ErrorState variant="card" title="Couldn't load service accounts" error={error} onRetry={() => void refetch()} retrying={isFetching} />
    )
  } else if (showEmptyState) {
    body = (
      <EmptyState
        variant="card"
        icon={<Bot className="h-6 w-6" />}
        title="No service accounts yet"
        description="Create a service account for CI/CD and automation."
        action={{ label: 'Create Service Account', onClick: () => setShowCreateDialog(true) }}
      />
    )
  } else {
    body = (
      <>
        <div className="relative mb-4 w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search service accounts by name or team"
            placeholder="Search name or team"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Table<ServiceAccountResponse>
          columns={columns}
          data={visible}
          keyExtractor={(row) => row.id}
          loading={isLoading && !!orgId}
          sort={sort ?? undefined}
          onSort={handleSort}
          emptyState={
            query.trim() ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No matching service accounts"
                description="Try a different search."
                action={{ label: 'Clear search', onClick: () => setQuery('') }}
              />
            ) : undefined
          }
          emptyMessage="No service accounts found"
          pagination={{
            cursor: cursor ?? null,
            hasMore: serviceAccounts?.has_more ?? false,
            hasPrevious: prevCursors.length > 0,
            onNext: () => {
              if (serviceAccounts?.next_cursor) {
                setPrevCursors((prev) => [...prev, cursor ?? ''])
                setCursor(serviceAccounts.next_cursor)
              }
            },
            onPrevious: () => {
              const prev = prevCursors[prevCursors.length - 1]
              setPrevCursors((p) => p.slice(0, -1))
              setCursor(prev || undefined)
            },
          }}
        />
      </>
    )
  }

  return (
    <>
      {!hideHeader && (
        <PageHeader title="Service Accounts" description="Manage service accounts for automation" actions={createButton} />
      )}
      <div className="mb-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {helpText}
        {hideHeader && <div className="shrink-0">{createButton}</div>}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Service Accounts" value={allSAs.length} icon={<Bot className="h-4 w-4" />} iconColor="purple" />
        <StatCard label="Org-Scoped" value={orgScopedCount} icon={<Building2 className="h-4 w-4" />} iconColor="blue" />
        <StatCard label="Team-Scoped" value={teamScopedCount} icon={<Users className="h-4 w-4" />} iconColor="green" />
      </div>

      {body}

      <CreateServiceAccountDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} orgId={orgId} />

      {editSa && (
        <EditServiceAccountDialog
          key={editSa.id}
          onClose={() => setEditSa(null)}
          sa={editSa}
          teamName={editSa.team_id ? teamNames.get(editSa.team_id) : undefined}
          orgId={orgId}
        />
      )}

      {deleteTarget && (
        <TypeToConfirmDialog
          key={deleteTarget.id}
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete service account"
          description={
            deleteTarget.key_count > 0
              ? `This also revokes its ${deleteTarget.key_count} key${deleteTarget.key_count === 1 ? '' : 's'}. This action cannot be undone.`
              : 'This action cannot be undone.'
          }
          confirmText={deleteTarget.name}
          confirmLabel="Delete"
          loading={deleteServiceAccount.isPending}
        />
      )}
    </>
  )
}
