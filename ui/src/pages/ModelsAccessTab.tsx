import { useState, useMemo } from 'react'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'
import { useModels } from '../hooks/useModels'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { ModelAllowlist } from './models/ModelAllowlist'

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useOrgModelAccess(orgId: string) {
  return useQuery({
    queryKey: ['model-access', orgId],
    queryFn: () => apiClient<{ models: string[] }>(`/orgs/${orgId}/model-access`),
    enabled: !!orgId,
  })
}

function useSetOrgModelAccess(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (models: string[]) =>
      apiClient<{ models: string[] }>(`/orgs/${orgId}/model-access`, {
        method: 'PUT',
        body: JSON.stringify({ models }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-access', orgId] })
      queryClient.invalidateQueries({ queryKey: ['available-models'] })
    },
  })
}

// ---------------------------------------------------------------------------
// ModelsAccessTab
// ---------------------------------------------------------------------------

export default function ModelsAccessTab() {
  const orgId = useActiveOrgId()

  const modelsQuery = useModels()
  const accessQuery = useOrgModelAccess(orgId)
  const access = accessQuery.data
  const setAccess = useSetOrgModelAccess(orgId)
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
        toast({ variant: 'success', message: 'Access control updated' })
        // Reset to null so UI re-derives from the freshly invalidated query
        setPendingModels(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to update access control') })
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
      canSave={isDirty && !!orgId}
      description="Select which models this organization can access. An empty list means all models are available."
      unrestrictedNote="All models are accessible — no restrictions applied."
    />
  )
}
