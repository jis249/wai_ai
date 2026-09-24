import React, { useMemo, useState } from 'react'
import { Table, type Column, type PaginationState } from '../ui/Table'
import { IconButton } from '../ui/IconButton'
import { Tooltip } from '../ui/Tooltip'
import { TimeAgo } from '../ui/TimeAgo'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Pencil, Search, UserMinus } from '../ui/icons'
import { useUsersByIds, type UserResponse } from '../../hooks/useUsers'
import { formatRole, roleRank } from '../../hooks/usePermissions'
import { RoleBadge } from './RoleBadge'
import { UserCell } from './UserCell'
import { ListToolbar, SearchField } from './SearchField'
import { matchesQuery, useClientSort } from './listState'
import {
  CONTEXT_ROLES,
  memberActionState,
  type MemberContext,
  type MemberRecord,
  type MemberViewer,
} from './memberRules'

export interface MembersTableProps<M extends MemberRecord> {
  context: MemberContext
  members: M[]
  viewer: MemberViewer
  loading?: boolean
  /** Query error; renders an ErrorState with retry when there are no rows. */
  error?: unknown
  onRetry?: () => void
  pagination?: PaginationState
  /**
   * True when `members` is the complete list (first page, no more pages). Enables the
   * "last org admin" guard, which needs the full admin count.
   */
  complete?: boolean
  onChangeRole?: (member: M, user: UserResponse | undefined) => void
  onRemove?: (member: M, user: UserResponse | undefined) => void
  /** Rendered when the list is empty (no filter applied). */
  emptyState?: React.ReactNode
}

const ALL = 'all'

/** Wraps a disabled control so its reason tooltip still shows on hover/focus. */
function DisabledReason({ reason, children }: { reason?: string; children: React.ReactElement }) {
  if (!reason) return children
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {children}
      </span>
    </Tooltip>
  )
}

/**
 * Members list shared by org Members, the system-admin org detail Members tab and team Members.
 * Search (name/email) + role filter + sortable columns; row actions are disabled with a reason
 * when the backend would reject them (higher/equal role, system admin, last org admin, self).
 */
export function MembersTable<M extends MemberRecord>({
  context,
  members,
  viewer,
  loading = false,
  error,
  onRetry,
  pagination,
  complete = false,
  onChangeRole,
  onRemove,
  emptyState,
}: MembersTableProps<M>) {
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState(ALL)

  const userIds = useMemo(() => members.map((m) => m.user_id), [members])
  const { byId: users, isLoading: usersLoading } = useUsersByIds(userIds)

  const orgAdminCount = members.filter((m) => m.role === 'org_admin').length

  const roleFilterOptions = useMemo(() => {
    const roles = new Set<string>(CONTEXT_ROLES[context])
    members.forEach((m) => roles.add(m.role))
    return [
      { value: ALL, label: 'All roles' },
      ...[...roles].sort((a, b) => roleRank(b) - roleRank(a)).map((r) => ({ value: r, label: formatRole(r) || r })),
    ]
  }, [context, members])

  const filtered = useMemo(
    () =>
      members.filter((m) => {
        if (roleFilter !== ALL && m.role !== roleFilter) return false
        const u = users.get(m.user_id)
        return matchesQuery(query, u?.display_name, u?.email)
      }),
    [members, roleFilter, query, users],
  )

  const { sorted, sort, onSort } = useClientSort<M>(filtered, {
    user: (m) => users.get(m.user_id)?.display_name ?? users.get(m.user_id)?.email ?? '',
    role: (m) => roleRank(m.role),
    created_at: (m) => Date.parse(m.created_at) || 0,
  })

  const showActions = viewer.canManage && (onChangeRole != null || onRemove != null)

  const columns: Column<M>[] = [
    {
      key: 'user',
      header: 'User',
      sortable: true,
      width: 'min-w-[12rem] max-w-[18rem]',
      render: (row) => (
        <UserCell
          user={users.get(row.user_id)}
          loading={usersLoading}
          fallbackId={row.user_id}
          isSelf={row.user_id === viewer.userId}
        />
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      render: (row) => <RoleBadge role={row.role} />,
    },
    {
      key: 'created_at',
      header: 'Joined',
      sortable: true,
      render: (row) => <TimeAgo date={row.created_at} className="whitespace-nowrap" />,
    },
  ]

  if (showActions) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => {
        const user = users.get(row.user_id)
        const state = memberActionState({
          context,
          viewer,
          member: row,
          targetIsSystemAdmin: user?.is_system_admin === true,
          isLastOrgAdmin: context === 'org' && complete && row.role === 'org_admin' && orgAdminCount <= 1,
        })
        const name = user?.display_name || user?.email || 'member'
        return (
          <div className="flex items-center justify-end gap-1">
            {onChangeRole != null && (
              <DisabledReason reason={state.canChangeRole ? undefined : state.changeRoleReason}>
                <IconButton
                  aria-label={`Change role for ${name}`}
                  icon={<Pencil />}
                  size="sm"
                  disabled={!state.canChangeRole}
                  tooltip={state.canChangeRole ? 'Change role' : false}
                  onClick={() => onChangeRole(row, user)}
                />
              </DisabledReason>
            )}
            {onRemove != null && (
              <DisabledReason reason={state.canRemove ? undefined : state.removeReason}>
                <IconButton
                  aria-label={`Remove ${name}`}
                  icon={<UserMinus />}
                  size="sm"
                  variant="destructive"
                  disabled={!state.canRemove}
                  tooltip={state.canRemove ? 'Remove' : false}
                  onClick={() => onRemove(row, user)}
                />
              </DisabledReason>
            )}
          </div>
        )
      },
    })
  }

  if (error != null && members.length === 0 && !loading) {
    return <ErrorState variant="card" title="Could not load members" error={error} onRetry={onRetry} />
  }

  const filtering = query.trim() !== '' || roleFilter !== ALL

  return (
    <div className="min-w-0">
      <ListToolbar>
        <SearchField value={query} onChange={setQuery} label="Search members" placeholder="Search name or email" />
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="block w-full cursor-pointer rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-44"
        >
          {roleFilterOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {filtering && (
          <span className="text-xs text-text-tertiary" role="status">
            {sorted.length} of {members.length} shown
          </span>
        )}
      </ListToolbar>
      <Table<M>
        columns={columns}
        data={sorted}
        keyExtractor={(row) => row.id}
        loading={loading}
        sort={sort}
        onSort={onSort}
        pagination={pagination}
        emptyState={
          filtering ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No matching members"
              description="Try a different name, email or role."
              action={{
                label: 'Clear filters',
                onClick: () => {
                  setQuery('')
                  setRoleFilter(ALL)
                },
              }}
            />
          ) : (
            emptyState
          )
        }
      />
    </div>
  )
}
