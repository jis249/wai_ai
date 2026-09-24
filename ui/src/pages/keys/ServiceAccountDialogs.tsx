import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { usePermissions } from '../../hooks/usePermissions'
import { useCreateServiceAccount, useUpdateServiceAccount } from '../../hooks/useServiceAccounts'
import type { ServiceAccountResponse, CreateServiceAccountParams } from '../../hooks/useServiceAccounts'
import { useTeams } from '../../hooks/useTeams'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/utils'

// ---------------------------------------------------------------------------
// CreateServiceAccountDialog
// ---------------------------------------------------------------------------

interface CreateServiceAccountDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
}

export function CreateServiceAccountDialog({ open, onClose, orgId }: CreateServiceAccountDialogProps) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>()
  const [teamId, setTeamId] = useState('')
  const [teamError, setTeamError] = useState<string | undefined>()

  const { isOrgAdmin } = usePermissions()
  const createServiceAccount = useCreateServiceAccount(orgId)
  const { data: teams } = useTeams(orgId)
  const { toast } = useToast()
  const pending = createServiceAccount.isPending

  // For non-admins with exactly one team, auto-select it without an effect.
  const autoTeamId = !isOrgAdmin && teams?.data?.length === 1 ? teams.data[0].id : ''
  const effectiveTeamId = teamId || autoTeamId

  const teamOptions = isOrgAdmin
    ? [{ value: '', label: 'Org-scoped (no team)' }, ...(teams?.data?.map((t) => ({ value: t.id, label: t.name })) ?? [])]
    : (teams?.data?.map((t) => ({ value: t.id, label: t.name })) ?? [])

  function handleClose() {
    setName('')
    setNameError(undefined)
    setTeamId('')
    setTeamError(undefined)
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    let hasError = false
    if (!trimmedName) {
      setNameError('Name is required')
      hasError = true
    } else {
      setNameError(undefined)
    }
    if (!isOrgAdmin && !effectiveTeamId) {
      setTeamError('Team is required')
      hasError = true
    } else {
      setTeamError(undefined)
    }
    if (hasError) return

    const params: CreateServiceAccountParams = {
      name: trimmedName,
      ...(effectiveTeamId ? { team_id: effectiveTeamId } : {}),
    }
    createServiceAccount.mutate(params, {
      onSuccess: () => {
        toast({ variant: 'success', message: 'Service account created' })
        handleClose()
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to create service account') })
      },
    })
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Create Service Account">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Select
          label="Team"
          options={teamOptions}
          value={effectiveTeamId}
          onChange={(val) => {
            setTeamId(val)
            if (val) setTeamError(undefined)
          }}
          placeholder={isOrgAdmin ? 'Org-scoped (no team)' : 'Select a team...'}
          error={teamError}
          disabled={pending}
        />
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ci-deploy-bot"
          error={nameError}
          disabled={pending}
        />
        {!isOrgAdmin && teamOptions.length === 0 && (
          <p className="text-xs text-text-tertiary">
            You are not a member of any team. Contact your org admin to be added to a team first.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={handleClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Create Service Account
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// EditServiceAccountDialog
// ---------------------------------------------------------------------------

interface EditServiceAccountDialogProps {
  onClose: () => void
  sa: ServiceAccountResponse
  teamName?: string
  orgId: string
}

export function EditServiceAccountDialog({ onClose, sa, teamName, orgId }: EditServiceAccountDialogProps) {
  const [name, setName] = useState(sa.name)
  const [nameError, setNameError] = useState<string | undefined>()
  const updateServiceAccount = useUpdateServiceAccount(orgId)
  const { toast } = useToast()
  const pending = updateServiceAccount.isPending
  const isDirty = name.trim() !== sa.name

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name is required')
      return
    }
    setNameError(undefined)
    updateServiceAccount.mutate(
      { saId: sa.id, name: trimmed },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'Service account updated' })
          onClose()
        },
        onError: (err) => {
          toast({ variant: 'error', message: errorMessage(err, 'Failed to update service account') })
        },
      },
    )
  }

  return (
    <Dialog open onClose={onClose} title="Edit Service Account">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Input
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (nameError) setNameError(undefined)
          }}
          error={nameError}
          disabled={pending}
        />
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="mb-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">Scope</dt>
            <dd className="truncate">
              {sa.team_id ? <Badge variant="info">Team{teamName ? `: ${teamName}` : ''}</Badge> : <Badge variant="default">Org</Badge>}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">Keys</dt>
            <dd className="text-sm text-text-primary">{sa.key_count}</dd>
          </div>
          <div>
            <dt className="mb-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">Created</dt>
            <dd className="text-sm text-text-tertiary">{formatDate(sa.created_at)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={!isDirty}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
