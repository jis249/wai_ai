import { useState, useMemo } from 'react'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { useParams } from 'react-router-dom'
import { useModels } from '../hooks/useModels'
import { useTeamModelAccess, useSetTeamModelAccess } from '../hooks/useTeamModelAccess'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { ModelAllowlist } from './models/ModelAllowlist'

export default function TeamModelsTab({ teamId: teamIdProp }: { teamId?: string }) {
  const { teamId: paramTeamId = '' } = useParams<{ teamId: string }>()
  const teamId = teamIdProp || paramTeamId
  const orgId = useActiveOrgId()

  const modelsQuery = useModels()
  const accessQuery = useTeamModelAccess(orgId, teamId)
  const access = accessQuery.data
  const setAccess = useSetTeamModelAccess(orgId, teamId)
  const { toast } = useToast()

  // null means "no unsaved edits — derive from server data".
  // Once the user makes a change this is populated with a copy of the server
  // set and subsequent toggles update it. On save success it resets to null.
  const [pendingModels, setPendingModels] = useState<Set<string> | null>(null)

  // The displayed selection: pending edits take priority over server data.
  const serverSet = useMemo(() => new Set(access?.models ?? []), [access?.models])
  const selectedModels = pendingModels ?? serverSet
  const isDirty = pendingModels !== null

  function toggleModel(name: string) {
    setPendingModels((prev) => {
      // First toggle: copy server baseline into local state
      const base = prev ?? new Set(access?.models ?? [])
      const next = new Set(base)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  function handleSave() {
    if (!pendingModels) return
    setAccess.mutate(Array.from(pendingModels), {
      onSuccess: () => {
        toast({ variant: 'success', message: 'Team model access updated' })
        setPendingModels(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to update model access') })
      },
    })
  }

  return (
    <ModelAllowlist
      models={modelsQuery.data?.data ?? []}
      modelsQuery={modelsQuery}
      accessQuery={accessQuery}
      selected={selectedModels}
      onToggle={toggleModel}
      onSave={handleSave}
      saving={setAccess.isPending}
      canSave={isDirty && !!orgId && !!teamId}
      description="Model access for this team. An empty allowlist means all org-accessible models are available."
      unrestrictedNote="All org-accessible models are available (no team restrictions)."
    />
  )
}
