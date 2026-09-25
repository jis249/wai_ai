import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { QueryState } from '../components/ui/QueryState'
import { Gauge, Users } from '../components/ui/icons'
import { LimitsForm } from '../components/settings/LimitsForm'
import { NameSlugFields } from '../components/settings/NameSlugFields'
import { validateNameSlug, type NameSlugErrors } from '../components/settings/nameSlug'
import { SettingsSkeleton } from '../components/settings/SettingsSkeleton'
import { limitsDirty, limitsFromRecord, limitsToParams, type LimitsValues } from '../components/settings/limits'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { usePermissions } from '../hooks/usePermissions'
import { useTeam, useUpdateTeam, type TeamResponse } from '../hooks/useTeams'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'

interface TeamSettingsFormProps {
  team: TeamResponse
  orgId: string
  canEdit: boolean
}

function TeamSettingsForm({ team, orgId, canEdit }: TeamSettingsFormProps) {
  const updateTeam = useUpdateTeam(orgId, team.id)
  const { toast } = useToast()

  const [basic, setBasic] = useState({ name: team.name, slug: team.slug })
  const [errors, setErrors] = useState<NameSlugErrors>({})
  const [limits, setLimits] = useState<LimitsValues>(() => limitsFromRecord(team))

  const isDirty = basic.name !== team.name || basic.slug !== team.slug || limitsDirty(limits, team)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateNameSlug(basic)
    setErrors(errs)
    if (errs.name || errs.slug) return
    updateTeam.mutate(
      { name: basic.name.trim(), slug: basic.slug.trim(), ...limitsToParams(limits) },
      {
        onSuccess: () => toast({ variant: 'success', message: 'Team settings saved' }),
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to save settings') }),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Card>
        <CardHeader title="Team" description="Display name and URL slug." icon={<Users className="h-5 w-5" />} />
        <NameSlugFields
          values={basic}
          errors={errors}
          onChange={setBasic}
          disabled={!canEdit || updateTeam.isPending}
          namePlaceholder="e.g. Backend Engineering"
          slugPlaceholder="e.g. backend-engineering"
        />
      </Card>

      <Card>
        <CardHeader
          title="Rate & token limits"
          description="Applied to every key in this team, within the organization's limits."
          icon={<Gauge className="h-5 w-5" />}
        />
        <LimitsForm
          values={limits}
          onChange={setLimits}
          readOnly={!canEdit}
          readOnlyNote={!canEdit ? 'Only team admins can change team limits.' : undefined}
          disabled={updateTeam.isPending}
        />
      </Card>

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" loading={updateTeam.isPending} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-tertiary">Only team admins can modify team settings.</p>
      )}
    </form>
  )
}

export default function TeamSettingsTab() {
  const { teamId = '' } = useParams<{ teamId: string }>()
  const perms = usePermissions()
  const orgId = useActiveOrgId()
  const teamQuery = useTeam(orgId, teamId)

  return (
    <div className="max-w-3xl">
      <QueryState query={teamQuery} loading={<SettingsSkeleton />} errorTitle="Could not load team settings">
        {(team) => <TeamSettingsForm key={team.id} team={team} orgId={orgId} canEdit={perms.canManageTeams} />}
      </QueryState>
    </div>
  )
}
