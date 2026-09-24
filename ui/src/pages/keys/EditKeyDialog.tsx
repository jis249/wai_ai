import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useUpdateAPIKey } from '../../hooks/useAPIKeys'
import type { APIKeyResponse } from '../../hooks/useAPIKeys'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { KeyLimitsFields } from './KeyLimitsFields'
import { EDIT_EXPIRES_OPTIONS, expiresAtFromOption, limitsFromKey } from './helpers'
import type { KeyLimitsValue } from './helpers'

interface EditKeyDialogProps {
  apiKey: APIKeyResponse
  onClose: () => void
  orgId: string
  /** Limits and expiry are admin-managed; the API rejects changes from other roles. */
  canEditLimits: boolean
}

/** Blank means 0 (unlimited) when editing. */
function limitOrZero(value: string): number {
  return value.trim() ? parseInt(value, 10) : 0
}

export function EditKeyDialog({ apiKey, onClose, orgId, canEditLimits }: EditKeyDialogProps) {
  const [name, setName] = useState(apiKey.name)
  const [expiresIn, setExpiresIn] = useState('keep')
  const [limits, setLimits] = useState<KeyLimitsValue>(() => limitsFromKey(apiKey))
  const [nameError, setNameError] = useState<string | undefined>()

  const updateKey = useUpdateAPIKey(orgId)
  const { toast } = useToast()
  const pending = updateKey.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Name is required')
      return
    }
    setNameError(undefined)

    const params: Record<string, unknown> = {}
    if (trimmedName !== apiKey.name) params.name = trimmedName

    if (canEditLimits) {
      if (expiresIn !== 'keep') params.expires_at = expiresAtFromOption(expiresIn) ?? null
      const fields: [keyof KeyLimitsValue, keyof APIKeyResponse, string][] = [
        ['dailyTokenLimit', 'daily_token_limit', 'daily_token_limit'],
        ['monthlyTokenLimit', 'monthly_token_limit', 'monthly_token_limit'],
        ['requestsPerMinute', 'requests_per_minute', 'requests_per_minute'],
        ['requestsPerDay', 'requests_per_day', 'requests_per_day'],
      ]
      for (const [formKey, keyField, param] of fields) {
        const parsed = limitOrZero(limits[formKey])
        if (!Number.isNaN(parsed) && parsed !== apiKey[keyField]) params[param] = parsed
      }
    }

    if (Object.keys(params).length === 0) {
      onClose()
      return
    }

    updateKey.mutate(
      { keyId: apiKey.id, params },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'API key updated' })
          onClose()
        },
        onError: (err) => {
          toast({ variant: 'error', message: errorMessage(err, 'Failed to update API key') })
        },
      },
    )
  }

  return (
    <Dialog open onClose={onClose} title="Edit API Key">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production backend"
          error={nameError}
          disabled={pending}
        />
        {canEditLimits ? (
          <>
            <Select
              label="Expires At"
              options={EDIT_EXPIRES_OPTIONS}
              value={expiresIn}
              onChange={setExpiresIn}
              disabled={pending}
            />
            <KeyLimitsFields value={limits} onChange={setLimits} disabled={pending} />
          </>
        ) : (
          <p className="text-xs text-text-tertiary">Expiry and limits are managed by your organization admin.</p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Save Changes
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
