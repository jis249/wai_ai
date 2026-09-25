import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Table, type Column } from '../components/ui/Table'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { TimeAgo } from '../components/ui/TimeAgo'
import { StatCard } from '../components/ui/StatCard'
import { IconButton } from '../components/ui/IconButton'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Cloud, Search, ShieldCheck, Trash2, Users } from '../components/ui/icons'
import { UserCell } from '../components/members/UserCell'
import { ListToolbar, SearchField } from '../components/members/SearchField'
import { matchesQuery, useClientSort, useCursorPager } from '../components/members/listState'
import { useMe } from '../hooks/useMe'
import { usePermissions } from '../hooks/usePermissions'
import { useUsers, useDeleteUser, type UserResponse } from '../hooks/useUsers'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'

// ---------------------------------------------------------------------------
// SystemUsersPage
// ---------------------------------------------------------------------------

export default function SystemUsersPage() {
  const { data: me } = useMe()
  const perms = usePermissions()
  const pager = useCursorPager()
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<UserResponse | null>(null)

  const usersQuery = useUsers(pager.cursor)
  const deleteUser = useDeleteUser()
  const { toast } = useToast()

  const allUsers = usersQuery.data?.data ?? []
  const filtered = allUsers.filter((u) => matchesQuery(query, u.display_name, u.email))
  const { sorted, sort, onSort } = useClientSort(filtered, {
    user: (u) => u.display_name || u.email,
    is_system_admin: (u) => (u.is_system_admin ? 1 : 0),
    auth_provider: (u) => u.auth_provider,
    created_at: (u) => Date.parse(u.created_at) || 0,
  })

  if (perms.isReady && !perms.isSystemAdmin) {
    return <Navigate to="/" replace />
  }

  const pending = usersQuery.isPending
  const adminCount = allUsers.filter((u) => u.is_system_admin).length
  const ssoCount = allUsers.filter((u) => u.auth_provider === 'oidc').length

  const columns: Column<UserResponse>[] = [
    {
      key: 'user',
      header: 'User',
      sortable: true,
      width: 'min-w-[12rem] max-w-[20rem]',
      render: (row) => <UserCell user={row} isSelf={row.id === me?.id} />,
    },
    {
      key: 'is_system_admin',
      header: 'Access',
      sortable: true,
      render: (row) =>
        row.is_system_admin ? (
          <Badge variant="default" icon={<ShieldCheck className="h-3 w-3" aria-hidden="true" />}>
            System admin
          </Badge>
        ) : (
          <Badge variant="muted">User</Badge>
        ),
    },
    {
      key: 'auth_provider',
      header: 'Sign-in',
      sortable: true,
      render: (row) => (
        <span className="text-text-secondary">{row.auth_provider === 'oidc' ? 'SSO' : row.auth_provider === 'local' ? 'Password' : row.auth_provider}</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row) => <TimeAgo date={row.created_at} className="whitespace-nowrap" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) =>
        row.id === me?.id ? null : (
          <IconButton
            aria-label={`Delete ${row.email}`}
            icon={<Trash2 />}
            size="sm"
            variant="destructive"
            disabled={deleteUser.isPending}
            onClick={() => setDeleteTarget(row)}
          />
        ),
    },
  ]

  function handleDelete() {
    if (!deleteTarget) return
    deleteUser.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `${deleteTarget.email} deleted` })
        setDeleteTarget(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete user') })
        setDeleteTarget(null)
      },
    })
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="All system users. New users are created when they first sign in with Microsoft."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Users" value={pending ? '-' : allUsers.length} icon={<Users className="h-4 w-4" />} iconColor="purple" />
        <StatCard label="System admins" value={pending ? '-' : adminCount} icon={<ShieldCheck className="h-4 w-4" />} iconColor="blue" />
        <StatCard label="SSO users" value={pending ? '-' : ssoCount} icon={<Cloud className="h-4 w-4" />} iconColor="green" />
      </div>

      {usersQuery.isError && allUsers.length === 0 ? (
        <ErrorState
          variant="card"
          title="Could not load users"
          error={usersQuery.error}
          onRetry={() => void usersQuery.refetch()}
          retrying={usersQuery.isFetching}
        />
      ) : (
        <div className="min-w-0">
          <ListToolbar>
            <SearchField value={query} onChange={setQuery} label="Search users" placeholder="Search name or email" />
          </ListToolbar>
          <Table<UserResponse>
            columns={columns}
            data={sorted}
            keyExtractor={(row) => row.id}
            loading={pending}
            sort={sort}
            onSort={onSort}
            pagination={pager.pagination(usersQuery.data)}
            emptyState={
              query.trim() ? (
                <EmptyState
                  icon={<Search className="h-6 w-6" />}
                  title="No matching users"
                  description="Try a different name or email."
                  action={{ label: 'Clear search', onClick: () => setQuery('') }}
                />
              ) : (
                <EmptyState
                  icon={<Users className="h-6 w-6" />}
                  title="No users yet"
                  description="Users appear here after they sign in with Microsoft."
                />
              )
            }
          />
        </div>
      )}


      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete user"
        description={`Delete ${deleteTarget?.email ?? 'this user'}? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteUser.isPending}
      />
    </>
  )
}
