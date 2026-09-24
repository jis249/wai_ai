import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Select } from '../components/ui/Select'
import { useMe } from '../hooks/useMe'
import { useTeams } from '../hooks/useTeams'
import TeamModelsTab from './TeamModelsTab'
import TeamMCPAccessTab from './TeamMCPAccessTab'

export default function TeamAccessPanel({ kind }: { kind: 'models' | 'mcp' }) {
  const { data: me } = useMe()
  const orgId = me?.org_id ?? ''
  const { data, isLoading } = useTeams(orgId)
  const teams = data?.data ?? []
  const [picked, setPicked] = useState('')
  const teamId = picked || teams[0]?.id || ''

  const options = useMemo(
    () => teams.map((t) => ({ value: t.id, label: t.name })),
    [teams],
  )

  if (isLoading) {
    return <p className="text-sm text-text-tertiary">Loading teams…</p>
  }

  if (teams.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No teams yet.{' '}
        <Link to="/teams" className="text-accent no-underline">
          Create a team
        </Link>{' '}
        to set per-team access.
      </p>
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
