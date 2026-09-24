import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Skeleton } from '../../components/ui/Skeleton'
import { useMe } from '../../hooks/useMe'
import { useCreateAPIKey } from '../../hooks/useAPIKeys'
import type { APIKeyResponse, CreateAPIKeyParams } from '../../hooks/useAPIKeys'
import { useTeams } from '../../hooks/useTeams'
import { useServiceAccounts } from '../../hooks/useServiceAccounts'
import { useAvailableModels } from '../../hooks/useAvailableModels'
import { useToast } from '../../hooks/useToast'
import apiClient from '../../api/client'
import { errorMessage } from '../../lib/errors'
import { KeyLimitsFields } from './KeyLimitsFields'
import { Stepper } from './Stepper'
import type { StepperStep } from './Stepper'
import { EMPTY_LIMITS, EXPIRES_OPTIONS, KEY_TYPE_OPTIONS, expiresAtFromOption, parseLimit, validateLimits } from './helpers'
import type { KeyLimitsValue, LimitErrors } from './helpers'

interface CreateKeyDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (key: string, created: APIKeyResponse) => void
  orgId: string
  /**
   * Whether the caller may set token/rate limits (org admin+; same as EditKeyDialog's
   * `canEditLimits`). When false the "Limits & expiry" step is skipped and expiry moves to Details.
   */
  canEditLimits?: boolean
}

type StepId = 'details' | 'access' | 'limits' | 'review'

const STEP_LABELS: Record<StepId, string> = {
  details: 'Details',
  access: 'Access',
  limits: 'Limits & expiry',
  review: 'Review',
}

const LIMIT_LABELS: { key: keyof KeyLimitsValue; label: string }[] = [
  { key: 'dailyTokenLimit', label: 'Daily tokens' },
  { key: 'monthlyTokenLimit', label: 'Monthly tokens' },
  { key: 'requestsPerMinute', label: 'Requests / minute' },
  { key: 'requestsPerDay', label: 'Requests / day' },
]

const sectionLabel = 'text-[10px] font-medium tracking-widest uppercase text-text-tertiary'

export function CreateKeyDialog({ open, onClose, onCreated, orgId, canEditLimits = false }: CreateKeyDialogProps) {
  const [stepIndex, setStepIndex] = useState(0)
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
  const [modelsError, setModelsError] = useState<string | undefined>()
  const [limits, setLimits] = useState<KeyLimitsValue>(EMPTY_LIMITS)
  const [limitErrors, setLimitErrors] = useState<LimitErrors>({})

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

  const stepIds: StepId[] = canEditLimits ? ['details', 'access', 'limits', 'review'] : ['details', 'access', 'review']
  const steps: StepperStep[] = stepIds.map((id) => ({ id, label: STEP_LABELS[id] }))
  const safeIndex = Math.min(stepIndex, stepIds.length - 1)
  const step = stepIds[safeIndex]
  const isLast = safeIndex === stepIds.length - 1

  const models = availableModels.data?.models ?? []
  const teamName = userTeams.find((t) => t.id === teamId)?.name
  const serviceAccountName = serviceAccounts?.data?.find((sa) => sa.id === serviceAccountId)?.name

  function handleClose() {
    setStepIndex(0)
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
    setModelsError(undefined)
    setLimits(EMPTY_LIMITS)
    setLimitErrors({})
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
    setModelsError(undefined)
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(modelName)) next.delete(modelName)
      else next.add(modelName)
      return next
    })
  }

  function validateDetails(): boolean {
    let ok = true
    if (!name.trim()) {
      setNameError('Name is required')
      ok = false
    } else setNameError(undefined)

    if (keyType === 'user_key' && userTeams.length > 1 && !teamId) {
      setTeamError('Select a team for this key')
      ok = false
    } else if (keyType === 'team_key' && !teamId) {
      setTeamError('Team is required')
      ok = false
    } else setTeamError(undefined)

    if (keyType === 'sa_key' && !serviceAccountId) {
      setServiceAccountError('Service account is required')
      ok = false
    } else setServiceAccountError(undefined)

    if (keyType === 'user_key' && !me?.id) {
      toast({ variant: 'info', message: 'Still loading your account. Try again in a moment.' })
      ok = false
    }
    return ok
  }

  function validateAccess(): boolean {
    if (restrictModels && selectedModels.size === 0) {
      setModelsError('Select at least one model, or allow all models')
      return false
    }
    setModelsError(undefined)
    return true
  }

  function validateLimitsStep(): boolean {
    const errors = validateLimits(limits)
    setLimitErrors(errors)
    return Object.keys(errors).length === 0
  }

  function validateStep(id: StepId): boolean {
    if (id === 'details') return validateDetails()
    if (id === 'access') return validateAccess()
    if (id === 'limits') return validateLimitsStep()
    return true
  }

  function handleNext() {
    if (!validateStep(step)) return
    setStepIndex(safeIndex + 1)
  }

  function handleBack() {
    setStepIndex(Math.max(0, safeIndex - 1))
  }

  function buildParams(): CreateAPIKeyParams {
    const params: CreateAPIKeyParams = {
      name: name.trim(),
      key_type: keyType,
      expires_at: expiresAtFromOption(expiresIn),
      ...(keyType === 'user_key' ? { user_id: me?.id } : {}),
      // User keys carry the chosen team too (the API checks the user belongs to it).
      ...((keyType === 'team_key' || keyType === 'user_key') && teamId ? { team_id: teamId } : {}),
      ...(keyType === 'sa_key' && serviceAccountId ? { service_account_id: serviceAccountId } : {}),
    }
    if (canEditLimits) {
      const daily = parseLimit(limits.dailyTokenLimit)
      if (daily !== undefined) params.daily_token_limit = daily
      const monthly = parseLimit(limits.monthlyTokenLimit)
      if (monthly !== undefined) params.monthly_token_limit = monthly
      const rpm = parseLimit(limits.requestsPerMinute)
      if (rpm !== undefined) params.requests_per_minute = rpm
      const rpd = parseLimit(limits.requestsPerDay)
      if (rpd !== undefined) params.requests_per_day = rpd
    }
    return params
  }

  function handleCreate() {
    // Re-check every step (a stale later step could have been edited via Back).
    for (let i = 0; i < stepIds.length - 1; i++) {
      if (!validateStep(stepIds[i])) {
        setStepIndex(i)
        return
      }
    }
    createKey.mutate(buildParams(), {
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    if (isLast) handleCreate()
    else handleNext()
  }

  const expirySelect = (
    <Select label="Expires in" options={EXPIRES_OPTIONS} value={expiresIn} onChange={setExpiresIn} disabled={pending} />
  )

  const expiresLabel = EXPIRES_OPTIONS.find((o) => o.value === expiresIn)?.label ?? expiresIn
  const typeLabel = KEY_TYPE_OPTIONS.find((o) => o.value === keyType)?.label ?? keyType
  const setLimitsList = LIMIT_LABELS.filter(({ key }) => limits[key].trim() !== '' && limits[key].trim() !== '0')

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create API Key"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={pending}>
            Cancel
          </Button>
          <div className="flex flex-wrap gap-2">
            {safeIndex > 0 && (
              <Button variant="secondary" onClick={handleBack} disabled={pending}>
                Back
              </Button>
            )}
            <Button type="submit" form="create-key-form" loading={pending}>
              {isLast ? 'Create key' : 'Next'}
            </Button>
          </div>
        </div>
      }
    >
      <Stepper steps={steps} current={safeIndex} className="mb-5" />
      <form id="create-key-form" onSubmit={handleSubmit} className="space-y-4" noValidate aria-label={STEP_LABELS[step]}>
        {step === 'details' && (
          <>
            <Input
              label="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError(undefined)
              }}
              placeholder="e.g. Production backend"
              error={nameError}
              disabled={pending}
              autoFocus
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
            {/* Non-admins skip the Limits step, so expiry lives here for them. */}
            {!canEditLimits && expirySelect}
          </>
        )}

        {step === 'access' && (
          <fieldset className="space-y-3">
            <legend className={sectionLabel}>Model access</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-accent">
              <input
                type="radio"
                name="model-access"
                className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                checked={!restrictModels}
                onChange={() => {
                  setRestrictModels(false)
                  setModelsError(undefined)
                }}
                disabled={pending}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">All models the org allows</span>
                <span className="block text-xs text-text-tertiary">
                  The key inherits model access from its team and organization.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-accent">
              <input
                type="radio"
                name="model-access"
                className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                checked={restrictModels}
                onChange={() => setRestrictModels(true)}
                disabled={pending}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">Only specific models</span>
                <span className="block text-xs text-text-tertiary">Restrict this key to the models you pick.</span>
              </span>
            </label>

            {restrictModels && (
              <div>
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
                  <div
                    role="group"
                    aria-label="Models"
                    className="max-h-56 overflow-y-auto rounded-lg border border-border p-1.5"
                  >
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
                {modelsError && (
                  <p className="mt-2 text-xs text-error" role="alert">
                    {modelsError}
                  </p>
                )}
                {selectedModels.size > 0 && (
                  <p className="mt-2 text-xs text-text-tertiary">{selectedModels.size} selected</p>
                )}
              </div>
            )}
          </fieldset>
        )}

        {step === 'limits' && (
          <>
            {expirySelect}
            <div className="border-t border-border pt-4">
              <p className={`${sectionLabel} mb-3`}>Rate &amp; token limits</p>
              <KeyLimitsFields value={limits} onChange={setLimits} disabled={pending} errors={limitErrors} />
            </div>
          </>
        )}

        {step === 'review' && (
          <dl className="divide-y divide-border rounded-lg border border-border text-sm">
            <ReviewRow label="Name">{name.trim()}</ReviewRow>
            <ReviewRow label="Type">{typeLabel}</ReviewRow>
            {showTeamPicker && teamName && <ReviewRow label="Team">{teamName}</ReviewRow>}
            {keyType === 'sa_key' && <ReviewRow label="Service account">{serviceAccountName ?? serviceAccountId}</ReviewRow>}
            <ReviewRow label="Models">
              {restrictModels && selectedModels.size > 0 ? (
                <span className="break-words font-mono text-xs">{Array.from(selectedModels).join(', ')}</span>
              ) : (
                'All models the org allows'
              )}
            </ReviewRow>
            <ReviewRow label="Expires">{expiresLabel}</ReviewRow>
            {canEditLimits && (
              <ReviewRow label="Limits">
                {setLimitsList.length === 0 ? (
                  'No limits'
                ) : (
                  <ul className="space-y-0.5">
                    {setLimitsList.map(({ key, label }) => (
                      <li key={key}>
                        {label}: {Number(limits[key]).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                )}
              </ReviewRow>
            )}
          </dl>
        )}
      </form>
    </Dialog>
  )
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-text-tertiary sm:w-32">{label}</dt>
      <dd className="min-w-0 text-text-primary">{children}</dd>
    </div>
  )
}
