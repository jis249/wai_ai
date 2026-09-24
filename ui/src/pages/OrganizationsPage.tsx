import React, { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Table, type Column } from '../components/ui/Table'
import { Dialog, ConfirmDialog } from '../components/ui/Dialog'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { TimeAgo } from '../components/ui/TimeAgo'
import { IconButton } from '../components/ui/IconButton'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/DropdownMenu'
import { Building2, Ellipsis, Plus, Search, Settings, ShieldCheck, Trash2, User, Users } from '../components/ui/icons'
import { NameSlugFields } from '../components/settings/NameSlugFields'
import { validateNameSlug, type NameSlugErrors } from '../components/settings/nameSlug'
import { ListToolbar, SearchField } from '../components/members/SearchField'
import { matchesQuery, useClientSort, useCursorPager } from '../components/members/listState'
import { usePermissions } from '../hooks/usePermissions'
import { useOrgs, useCreateOrg, useDeleteOrg, type OrgListItem } from '../hooks/useOrgs'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { deriveSlug } from '../lib/slug'

// ---------------------------------------------------------------------------
// CreateOrgDialog
// ---------------------------------------------------------------------------

function CreateOrgDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [values, setValues] = useState({ name: '', slug: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<NameSlugErrors>({})

  const createOrg = useCreateOrg()
  const { toast } = useToast()

  function handleChange(next: { name: string; slug: string }) {
    if (next.slug !== values.slug) {
      setSlugTouched(true)
      setValues(next)
    } else {
      setValues({ name: next.name, slug: slugTouched ? next.slug : deriveSlug(next.name) })
    }
  }

  function handleClose() {
    setValues({ name: '', slug: '' })
    setSlugTouched(false)
    setErrors({})
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateNameSlug(values)
    setErrors(errs)
    if (errs.name || errs.slug) return
    createOrg.mutate(
      { name: values.name.trim(), slug: values.slug.trim() },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'Organization created' })
          handleClose()
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to create organization') }),
      },
    )
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Create organization">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <NameSlugFields
          values={values}
          errors={errors}
          onChange={handleChange}
          disabled={createOrg.isPending}
          namePlaceholder="e.g. Acme Corp"
          slugPlaceholder="e.g. acme-corp"
        />
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={createOrg.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={createOrg.isPending}>
            Create organization
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// OrganizationsPage
// ---------------------------------------------------------------------------

export default function OrganizationsPage() {
  const perms = usePermissions()
  const navigate = useNavigate()
  const pager = useCursorPager()
  const [query, setQuery] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OrgListItem | null>(null)

  const orgsQuery = useOrgs(pager.cursor)
  const deleteOrg = useDeleteOrg()
  const { toast } = useToast()

  const orgList = orgsQuery.data?.data ?? []
  const filtered = orgList.filter((o) => matchesQuery(query, o.name, o.slug))
  const { sorted, sort, onSort } = useClientSort(filtered, {
    name: (o) => o.name,
    member_count: (o) => o.member_count ?? 0,
    team_count: (o) => o.team_count ?? 0,
    created_at: (o) => Date.parse(o.created_at) || 0,
  })

  if (perms.isReady && !perms.isSystemAdmin) {
    return <Navigate to="/" replace />
  }

  const pending = orgsQuery.isPending
  const totalMembers = orgList.reduce((s, o) => s + (o.member_count ?? 0), 0)
  const totalTeams = orgList.reduce((s, o) => s + (o.team_count ?? 0), 0)

  const columns: Column<OrgListItem>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <div className="min-w-0 max-w-[16rem]">
          <Link to={`/orgs/${row.id}`} className="block truncate font-medium text-accent no-underline hover:underline">
            {row.name}
          </Link>
          <Badge variant="muted" className="mt-1 max-w-full truncate">
            {row.slug}
          </Badge>
        </div>
      ),
    },
    {
      key: 'member_count',
      header: 'Members',
      sortable: true,
      align: 'right',
      render: (row) => <span className="tabular-nums text-text-secondary">{row.member_count ?? 0}</span>,
    },
    {
      key: 'team_count',
      header: 'Teams',
      sortable: true,
      align: 'right',
      render: (row) => <span className="tabular-nums text-text-secondary">{row.team_count ?? 0}</span>,
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
      render: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={`Actions for ${row.name}`} icon={<Ellipsis />} size="sm" tooltip={false} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem icon={<Users />} onSelect={() => navigate(`/orgs/${row.id}/members`)}>
              Members
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Building2 />} onSelect={() => navigate(`/orgs/${row.id}/teams`)}>
              Teams
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Settings />} onSelect={() => navigate(`/orgs/${row.id}/settings`)}>
              Settings &amp; limits
            </DropdownMenuItem>
            <DropdownMenuItem icon={<ShieldCheck />} onSelect={() => navigate(`/orgs/${row.id}/sso`)}>
              SSO
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleteTarget(row)}>
              Delete organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  function handleDelete() {
    if (!deleteTarget) return
    deleteOrg.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `${deleteTarget.name} deleted` })
        setDeleteTarget(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete organization') })
        setDeleteTarget(null)
      },
    })
  }

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Manage all organizations in the system"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateDialog(true)}>
            Create organization
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Organizations" value={pending ? '-' : orgList.length} iconColor="purple" icon={<Building2 className="h-4 w-4" />} />
        <StatCard label="Members" value={pending ? '-' : totalMembers} iconColor="blue" icon={<User className="h-4 w-4" />} />
        <StatCard label="Teams" value={pending ? '-' : totalTeams} iconColor="green" icon={<Users className="h-4 w-4" />} />
      </div>

      {orgsQuery.isError && orgList.length === 0 ? (
        <ErrorState
          variant="card"
          title="Could not load organizations"
          error={orgsQuery.error}
          onRetry={() => void orgsQuery.refetch()}
          retrying={orgsQuery.isFetching}
        />
      ) : (
        <div className="min-w-0">
          <ListToolbar>
            <SearchField value={query} onChange={setQuery} label="Search organizations" placeholder="Search name or slug" />
          </ListToolbar>
          <Table<OrgListItem>
            columns={columns}
            data={sorted}
            keyExtractor={(row) => row.id}
            loading={pending}
            sort={sort}
            onSort={onSort}
            pagination={pager.pagination(orgsQuery.data)}
            emptyState={
              query.trim() ? (
                <EmptyState
                  icon={<Search className="h-6 w-6" />}
                  title="No matching organizations"
                  description="Try a different name or slug."
                  action={{ label: 'Clear search', onClick: () => setQuery('') }}
                />
              ) : (
                <EmptyState
                  icon={<Building2 className="h-6 w-6" />}
                  title="No organizations yet"
                  description="Create an organization to get started."
                  action={{ label: 'Create organization', onClick: () => setShowCreateDialog(true) }}
                />
              )
            }
          />
        </div>
      )}

      <CreateOrgDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete organization"
        description={`Delete ${deleteTarget?.name ?? 'this organization'}? All teams, members, and keys will be permanently removed.`}
        confirmLabel="Delete"
        loading={deleteOrg.isPending}
      />
    </>
  )
}
