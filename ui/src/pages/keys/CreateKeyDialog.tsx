import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Toggle } from '../../components/ui/Toggle'
import { Skeleton } from '../../components/ui/Skeleton'
import { ChevronDown } from '../../components/ui/icons'
import { useMe } from '../../hooks/useMe'
import { useCreateAPIKey } from '../../hooks/useAPIKeys'
import type { APIKeyResponse, CreateAPIKeyParams } from '../../hooks/useAPIKeys'
import { useTeams } from '../../hooks/useTeams'
import { useServiceAccounts } from '../../hooks/useServiceAccounts'
import { useAvailableModels } from '../../hooks/useAvailableModels'
import { useToast } from '../../hooks/useToast'
import apiClient from '../../api/client'
import { errorMessage } from '../../lib/errors'
import { cn } from '../../lib/utils'
import { KeyLimitsFields } from './KeyLimitsFields'
import { EMPTY_LIMITS, EXPIRES_OPTIONS, KEY_TYPE_OPTIONS, expiresAtFromOption, parseLimit } from './helpers'
import type { KeyLimitsValue } from './helpers'

interface CreateKeyDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (key: string, created: APIKeyResponse) => void
  orgId: string
}

const sectionLabel = 'text-[10px] font-medium tracking-widest uppercase text-text-tertiary'

export function CreateKeyDialog({ open, onClose, onCreated, orgId }: CreateKeyDialogProps) {
  const [name, setName] = useState('')
  const [keyType, setKeyType] = useState('user_key')
  const [expiresIn, setExpiresIn] = useState('90d')
  const [nameError, setNameError] = useState<string | undefined>()
  const [teamId, setTeamId] = useState('')
  const [serviceAccountId, setServiceAccountId] = useState('')
  const [teamError, setTeamError] = useState<string | undefined>()
  const [serviceAccountError, setServiceAccountError] = useState<string | undefined>()
  const [restrictModels, setRestrictModels] = useState(false)
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [showAdvancedLimits, setShowAdvancedLimits] = useState(false)
  const [limits, setLimits] = useState<KeyLimitsValue>(EMPTY_LIMITS)

  const { data: me } = useMe()
  const { data: teams } = useTeams(orgId)
  const { data: serviceAccounts } = useServiceAccounts(orgId)
  const availableModels = useAvailableModels()

  const userTeams = teams?.data ?? []
  const showTeamPickerForUserKey = keyType === 'user_key' && userTeams.length > 1
  const showTeamPicker = keyType === 'team_key' || showTeamPickerForUserKey

  const createKey = useCreateAPIKey(orgId)
  const { toast } = useToast()
  const pending = createKey.isPending

  function handleClose() {
    setName('')
    setKeyType('user_key')
    setExpiresIn('90d')
    setNameError(undefined)
    setTeamId('')
    setServiceAccountId('')
    setTeamError(undefined)
    setServiceAccountError(undefined)
    setRestrictModels(false)
    setSelectedModels(new Set())
    setShowAdvancedLimits(false)
    setLimits(EMPTY_LIMITS)
    onClose()
  }

  function handleKeyTypeChange(newType: string) {
    setKeyType(newType)
    setTeamId('')
    setServiceAccountId('')
    setTeamError(undefined)
    setServiceAccountError(undefined)
  }

  function toggleModel(modelName: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(modelName)) next.delete(modelName)
      else next.add(modelName)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent | React.MouseEvent) {
    e.preventDefault()

    const trimmedName = name.trim()
    let hasError = false

    if (!trimmedName) {
      setNameError('Name is required')
      hasError = true
    } else {
      setNameError(undefined)
    }

    if (keyType === 'user_key' && userTeams.length > 1 && !teamId) {
      setTeamError('Select a team for this key')
      hasError = true
    } else if (keyType === 'team_key' && !teamId) {
      setTeamError('Team is required')
      hasError = true
    } else {
      setTeamError(undefined)
    }

    if (keyType === 'user_key' && !me?.id) hasError = true

    if (keyType === 'sa_key' && !serviceAccountId) {
      setServiceAccountError('Service account is required')
      hasError = true
    } else {
      setServiceAccountError(undefined)
    }

    if (hasError) return

    const params: CreateAPIKeyParams = {
      name: trimmedName,
      key_type: keyType,
      expires_at: expiresAtFromOption(expiresIn),
      ...(keyType === 'user_key' ? { user_id: me?.id } : {}),
      // User keys carry the chosen team too (the API checks the user belongs to it).
      ...((keyType === 'team_key' || keyType === 'user_key') && teamId ? { team_id: teamId } : {}),
      ...(keyType === 'sa_key' && serviceAccountId ? { service_account_id: serviceAccountId } : {}),
    }

    const daily = parseLimit(limits.dailyTokenLimit)
    if (daily !== undefined) params.daily_token_limit = daily
    const monthly = parseLimit(limits.monthlyTokenLimit)
    if (monthly !== undefined) params.monthly_token_limit = monthly
    const rpm = parseLimit(limits.requestsPerMinute)
    if (rpm !== undefined) params.requests_per_minute = rpm
    const rpd = parseLimit(limits.requestsPerDay)
    if (rpd !== undefined) params.requests_per_day = rpd

    createKey.mutate(params, {
      onSuccess: async (data) => {
        if (restrictModels && selectedModels.size > 0) {
          try {
            await apiClient(`/orgs/${orgId}/keys/${data.id}/model-access`, {
              method: 'PUT',
              body: JSON.stringify({ models: Array.from(selectedModels) }),
            })
          } catch {
            toast({ variant: 'error', message: 'Key created but model access could not be set' })
          }
        }
        handleClose()
        if (data.key) onCreated(data.key, data)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to create API key') })
      },
    })
  }

  const models = availableModels.data?.models ?? []

  return (
    <Dialog open={open} onClose={handleClose} title="Create API Key">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production backend"
          error={nameError}
          disabled={pending}
        />
        <div>
          <p id="create-key-type-label" className="mb-2 block text-sm font-medium text-text-secondary">
            Key type
          </p>
          <SegmentedControl
            aria-labelledby="create-key-type-label"
            size="sm"
            fullWidth
            options={KEY_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label, disabled: pending }))}
            value={keyType}
            onChange={handleKeyTypeChange}
          />
        </div>
        {showTeamPicker && (
          <Select
            label="Team"
            options={userTeams.map((t) => ({ value: t.id, label: t.name }))}
            value={teamId}
            onChange={(v) => {
              setTeamId(v)
              setTeamError(undefined)
            }}
            placeholder="Select a team..."
            searchable
            error={teamError}
            disabled={pending}
          />
        )}
        {keyType === 'sa_key' && (
          <Select
            label="Service Account"
            options={serviceAccounts?.data?.map((sa) => ({ value: sa.id, label: sa.name })) ?? []}
            value={serviceAccountId}
            onChange={(v) => {
              setServiceAccountId(v)
              setServiceAccountError(undefined)
            }}
            placeholder="Select a service account..."
            searchable
            error={serviceAccountError}
            disabled={pending}
          />
        )}
        <Select label="Expires In" options={EXPIRES_OPTIONS} value={expiresIn} onChange={setExpiresIn} disabled={pending} />

        {/* Rate & token limits — collapsible */}
        <div className="border-t border-border pt-4">
          <button
            type="button"
            className="flex w-full items-center justify-between"
            onClick={() => setShowAdvancedLimits((v) => !v)}
            aria-expanded={showAdvancedLimits}
            disabled={pending}
          >
            <span className={sectionLabel}>Rate &amp; Token Limits</span>
            <ChevronDown
              aria-hidden="true"
              className={cn('h-3.5 w-3.5 text-text-tertiary transition-transform duration-150', showAdvancedLimits && 'rotate-180')}
            />
          </button>
          {showAdvancedLimits && (
            <div className="mt-4">
              <KeyLimitsFields value={limits} onChange={setLimits} disabled={pending} />
            </div>
          )}
        </div>

        {/* Model access */}
        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={sectionLabel}>Model Access</span>
            <Toggle checked={restrictModels} onChange={setRestrictModels} label="Restrict models" size="sm" disabled={pending} />
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            {restrictModels
              ? 'Only selected models will be accessible with this key.'
              : 'Key inherits model access from team and organization scope.'}
          </p>

          {restrictModels && (
            <div className="mt-3">
              {availableModels.isError ? (
                <p className="text-xs text-error" role="alert">
                  Could not load models: {errorMessage(availableModels.error)}{' '}
                  <button type="button" className="underline" onClick={() => void availableModels.refetch()}>
                    Retry
                  </button>
                </p>
              ) : availableModels.isPending ? (
                <div className="space-y-2 rounded-lg border border-border p-3" aria-label="Loading models">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-40" />
                  ))}
                </div>
              ) : models.length === 0 ? (
                <p className="text-xs text-text-tertiary">No models available.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border p-1.5">
                  {models.map((m) => (
                    <label
                      key={m.name}
                      className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-bg-tertiary"
                    >
                      <input
                        type="checkbox"
                        checked={selectedModels.has(m.name)}
                        onChange={() => toggleModel(m.name)}
                        className="accent-accent h-4 w-4 shrink-0 cursor-pointer"
                        disabled={pending}
                      />
                      <span className="min-w-0 truncate font-mono text-sm text-text-primary">{m.name}</span>
                      {m.type !== 'chat' && <span className="ml-auto text-xs text-text-tertiary">{m.type}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Create Key
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
