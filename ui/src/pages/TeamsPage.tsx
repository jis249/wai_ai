import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { KeyRound, Plus, User, Users } from '../components/ui/icons'
import { CreateTeamDialog } from '../components/members/CreateTeamDialog'
import { TeamsTable } from '../components/members/TeamsTable'
import { useCursorPager } from '../components/members/listState'
import { useMe } from '../hooks/useMe'
import { usePermissions } from '../hooks/usePermissions'
import { useTeams, useDeleteTeam, type TeamResponse } from '../hooks/useTeams'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'

export default function TeamsPage() {
  const { data: me } = useMe()
  const perms = usePermissions()
  const orgId = me?.org_id ?? ''
  const isOrgAdmin = perms.isOrgAdmin
  const pager = useCursorPager()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TeamResponse | null>(null)

  const teamsQuery = useTeams(orgId, pager.cursor)
  const deleteTeam = useDeleteTeam(orgId)
  const { toast } = useToast()

  if (perms.isReady && me && !perms.canManageTeams) {
    return <Navigate to="/" replace />
  }

  const teams = teamsQuery.data?.data ?? []
  const totalMembers = teams.reduce((sum, t) => sum + t.member_count, 0)
  const totalKeys = teams.reduce((sum, t) => sum + t.key_count, 0)
  const pending = teamsQuery.isPending && !!orgId

  function handleDelete() {
    if (!deleteTarget) return
    deleteTeam.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `Team ${deleteTarget.name} deleted` })
        setDeleteTarget(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete team') })
        setDeleteTarget(null)
      },
    })
  }

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group members and keys, and scope model access and limits."
        actions={
          isOrgAdmin ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateDialog(true)}>
              Create team
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Teams" value={pending ? '-' : teams.length} icon={<Users className="h-4 w-4" />} iconColor="purple" />
        <StatCard label="Memberships" value={pending ? '-' : totalMembers} icon={<User className="h-4 w-4" />} iconColor="blue" />
        <StatCard label="Team keys" value={pending ? '-' : totalKeys} icon={<KeyRound className="h-4 w-4" />} iconColor="green" />
      </div>

      <TeamsTable
        teams={teams}
        loading={pending}
        error={teamsQuery.isError ? teamsQuery.error : undefined}
        onRetry={() => void teamsQuery.refetch()}
        pagination={pager.pagination(teamsQuery.data)}
        linkBase="/teams"
        onDelete={isOrgAdmin ? setDeleteTarget : undefined}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No teams yet"
            description="Create a team to organize members and keys."
            action={isOrgAdmin ? { label: 'Create team', onClick: () => setShowCreateDialog(true) } : undefined}
          />
        }
      />

      <CreateTeamDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} orgId={orgId} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete team"
        description={`Delete ${deleteTarget?.name ?? 'this team'}? All team memberships will be removed.`}
        confirmLabel="Delete"
        loading={deleteTeam.isPending}
      />
    </>
  )
}
