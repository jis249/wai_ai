import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { useCreateDeployment, useUpdateDeployment } from '../../hooks/useModels'
import type { DeploymentResponse } from '../../hooks/useModels'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { DeploymentFields } from './DeploymentFields'
import type { DeploymentEntry, DeploymentEntryErrors } from './DeploymentFields'

export interface DeploymentDialogProps {
  modelId: string
  /** null = add a new deployment. */
  deployment: DeploymentResponse | null
  onClose: () => void
}

function toEntry(deployment: DeploymentResponse | null): DeploymentEntry {
  return {
    name: deployment?.name ?? '',
    provider: deployment?.provider ?? 'openai',
    baseUrl: deployment?.base_url ?? '',
    apiKey: '',
    azureDeployment: deployment?.azure_deployment ?? '',
    azureApiVersion: deployment?.azure_api_version ?? '',
    weight: String(deployment?.weight ?? 1),
    priority: String(deployment?.priority ?? 0),
  }
}

/** Add / edit a single deployment of an existing load-balanced model. */
export function DeploymentDialog({ modelId, deployment, onClose }: DeploymentDialogProps) {
  const isEdit = deployment !== null
  const [entry, setEntry] = useState<DeploymentEntry>(() => toEntry(deployment))
  const [errors, setErrors] = useState<DeploymentEntryErrors>({})

  const createDeployment = useCreateDeployment()
  const updateDeployment = useUpdateDeployment()
  const { toast } = useToast()

  const isPending = createDeployment.isPending || updateDeployment.isPending
  const isAzure = entry.provider === 'azure'

  function validate(): boolean {
    const next: DeploymentEntryErrors = {}
    if (!entry.name.trim()) next.name = 'Name is required'
    if (!entry.provider) next.provider = 'Provider is required'
    if (!isEdit && !entry.baseUrl.trim()) next.base_url = 'Base URL is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(e: React.MouseEvent) {
    e.preventDefault()
    if (!validate()) return

    const name = entry.name.trim()
    const baseUrl = entry.baseUrl.trim()
    const apiKey = entry.apiKey.trim()
    const azureDeployment = entry.azureDeployment.trim()
    const azureApiVersion = entry.azureApiVersion.trim()
    const parsedWeight = parseInt(entry.weight, 10)
    const parsedPriority = parseInt(entry.priority, 10)

    if (isEdit) {
      const params: Record<string, unknown> = {}
      if (name !== deployment.name) params.name = name
      if (entry.provider !== deployment.provider) params.provider = entry.provider
      if (baseUrl && baseUrl !== deployment.base_url) params.base_url = baseUrl
      if (apiKey) params.api_key = apiKey
      if (isAzure && azureDeployment !== (deployment.azure_deployment ?? '')) {
        params.azure_deployment = azureDeployment || undefined
      }
      if (isAzure && azureApiVersion !== (deployment.azure_api_version ?? '')) {
        params.azure_api_version = azureApiVersion || undefined
      }
      if (!isNaN(parsedWeight) && parsedWeight !== deployment.weight) params.weight = parsedWeight
      if (!isNaN(parsedPriority) && parsedPriority !== deployment.priority) params.priority = parsedPriority

      updateDeployment.mutate(
        { modelId, deploymentId: deployment.id, params },
        {
          onSuccess: () => {
            toast({ variant: 'success', message: 'Deployment updated' })
            onClose()
          },
          onError: (err) => {
            toast({ variant: 'error', message: errorMessage(err, 'Failed to update deployment') })
          },
        },
      )
    } else {
      createDeployment.mutate(
        {
          modelId,
          params: {
            name,
            provider: entry.provider,
            base_url: baseUrl,
            api_key: apiKey || undefined,
            azure_deployment: isAzure && azureDeployment ? azureDeployment : undefined,
            azure_api_version: isAzure && azureApiVersion ? azureApiVersion : undefined,
            weight: !isNaN(parsedWeight) ? parsedWeight : 1,
            priority: !isNaN(parsedPriority) ? parsedPriority : 0,
          },
        },
        {
          onSuccess: () => {
            toast({ variant: 'success', message: 'Deployment added' })
            onClose()
          },
          onError: (err) => {
            toast({ variant: 'error', message: errorMessage(err, 'Failed to add deployment') })
          },
        },
      )
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? 'Edit Deployment' : 'Add Deployment'}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isPending}>
            {isEdit ? 'Save Changes' : 'Add Deployment'}
          </Button>
        </div>
      }
    >
      <DeploymentFields
        value={entry}
        onChange={(patch) => setEntry((prev) => ({ ...prev, ...patch }))}
        errors={errors}
        disabled={isPending}
        isEdit={isEdit}
      />
    </Dialog>
  )
}
