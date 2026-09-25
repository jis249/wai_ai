import { useMemo, useState } from 'react'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { useNavigate } from 'react-router-dom'
import { Select } from '../components/ui/Select'
import { Skeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Users } from '../components/ui/icons'
import { useTeams } from '../hooks/useTeams'
import TeamModelsTab from './TeamModelsTab'
import TeamMCPAccessTab from './TeamMCPAccessTab'

export default function TeamAccessPanel({ kind }: { kind: 'models' | 'mcp' }) {
  const orgId = useActiveOrgId()
  const teamsQuery = useTeams(orgId)
  const { data, isLoading } = teamsQuery
  const navigate = useNavigate()
  const teams = useMemo(() => data?.data ?? [], [data])
  const [picked, setPicked] = useState('')
  const teamId = picked || teams[0]?.id || ''

  const options = useMemo(
    () => teams.map((t) => ({ value: t.id, label: t.name })),
    [teams],
  )

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    )
  }

  if (teamsQuery.isError && data === undefined) {
    return (
      <ErrorState
        variant="card"
        title="Couldn't load teams"
        error={teamsQuery.error}
        onRetry={() => void teamsQuery.refetch()}
        retrying={teamsQuery.isFetching}
      />
    )
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={<Users className="h-6 w-6" />}
        title="No teams yet"
        description="Create a team to set per-team access."
        action={{ label: 'Create a team', onClick: () => navigate('/teams') }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Select
        label="Team"
        options={options}
        value={teamId}
        onChange={setPicked}
        fullWidth
      />
      {kind === 'models' ? <TeamModelsTab teamId={teamId} /> : <TeamMCPAccessTab teamId={teamId} />}
    </div>
  )
}
