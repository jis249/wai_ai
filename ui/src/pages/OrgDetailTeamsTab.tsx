import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { Plus, User, Users } from '../components/ui/icons'
import { CreateTeamDialog } from '../components/members/CreateTeamDialog'
import { TeamsTable } from '../components/members/TeamsTable'
import { useCursorPager } from '../components/members/listState'
import { useTeams, useDeleteTeam, type TeamResponse } from '../hooks/useTeams'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'

/** /orgs/:orgId/teams: system-admin view of an organization's teams. */
export default function OrgDetailTeamsTab() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const pager = useCursorPager()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TeamResponse | null>(null)

  const teamsQuery = useTeams(orgId, pager.cursor)
  const deleteTeam = useDeleteTeam(orgId)
  const { toast } = useToast()

  const teams = teamsQuery.data?.data ?? []
  const totalMembers = teams.reduce((sum, t) => sum + (t.member_count ?? 0), 0)
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-text-secondary">Teams in this organization.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateDialog(true)}>
          Create team
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Teams" value={pending ? '-' : teams.length} iconColor="purple" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Memberships" value={pending ? '-' : totalMembers} iconColor="blue" icon={<User className="h-4 w-4" />} />
      </div>

      <TeamsTable
        teams={teams}
        loading={pending}
        error={teamsQuery.isError ? teamsQuery.error : undefined}
        onRetry={() => void teamsQuery.refetch()}
        pagination={pager.pagination(teamsQuery.data)}
        onDelete={setDeleteTarget}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No teams yet"
            description="Create a team to organize members."
            action={{ label: 'Create team', onClick: () => setShowCreateDialog(true) }}
          />
        }
      />

      <CreateTeamDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} orgId={orgId} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete team"
        description={`Delete ${deleteTarget?.name ?? 'this team'}? All team keys and memberships will be permanently removed.`}
        confirmLabel="Delete"
        loading={deleteTeam.isPending}
      />
    </>
  )
}
