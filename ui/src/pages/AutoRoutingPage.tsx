import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import type { SelectOption } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import { useMe } from '../hooks/useMe'
import { useModels } from '../hooks/useModels'
import { useToast } from '../hooks/useToast'
import {
  useAutoRouterConfig,
  useUpdateAutoRouterConfig,
  type ComplexMode,
} from '../hooks/useAutoRouterConfig'

const COMPLEX_OPTIONS: SelectOption[] = [
  {
    value: 'random',
    label: 'Pick at random',
    description: 'Choose a random accessible model for complex prompts',
  },
  {
    value: 'fixed',
    label: 'Use a specific model',
    description: 'Always route complex prompts to one model you select',
  },
]

export default function AutoRoutingPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const isSystemAdmin = me?.is_system_admin === true || me?.role === 'system_admin'
  const { data: config, isLoading, isError } = useAutoRouterConfig(isSystemAdmin)
  const { data: modelsPage } = useModels()
  const update = useUpdateAutoRouterConfig()
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(true)
  const [defaultModel, setDefaultModel] = useState('')
  const [classifierModel, setClassifierModel] = useState('')
  const [complexMode, setComplexMode] = useState<ComplexMode>('random')
  const [complexModel, setComplexModel] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!config) return
    setEnabled(config.enabled)
    setDefaultModel(config.default_model)
    setClassifierModel(config.classifier_model)
    setComplexMode(config.complex_mode)
    setComplexModel(config.complex_model || '')
    setDirty(false)
  }, [config])

  const chatModels = useMemo(() => {
    const rows = modelsPage?.data ?? []
    return rows.filter((m) => m.is_active !== false && (m.type === 'chat' || m.type === 'completion' || !m.type))
  }, [modelsPage])

  const modelOptions: SelectOption[] = useMemo(
    () =>
      chatModels.map((m) => ({
        value: m.name,
        label: m.name,
        description: `${m.provider || 'unknown'} · ${m.type || 'chat'}`,
      })),
    [chatModels],
  )

  if (!meLoading && me && !isSystemAdmin) {
    return <Navigate to="/" replace />
  }

  const markDirty = () => setDirty(true)

  const onSave = async () => {
    if (complexMode === 'fixed' && !complexModel) {
      toast({ variant: 'error', message: 'Choose a model for complex prompts' })
      return
    }
    if (!defaultModel) {
      toast({ variant: 'error', message: 'Choose a default model' })
      return
    }
    try {
      await update.mutateAsync({
        enabled,
        default_model: defaultModel,
        classifier_model: classifierModel || defaultModel,
        complex_mode: complexMode,
        complex_model: complexMode === 'fixed' ? complexModel : '',
      })
      setDirty(false)
      toast({ variant: 'success', message: 'Auto routing saved — applies immediately' })
    } catch (err) {
      toast({
        variant: 'error',
        message: err instanceof Error ? err.message : 'Failed to save auto routing',
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Auto routing"
        description="Configure how model auto chooses the best upstream model for each prompt."
        actions={
          <Button onClick={onSave} disabled={!dirty || update.isPending || isLoading}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        }
      />

      <div className="rounded-lg border border-border bg-bg-secondary max-w-3xl">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Router settings</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            Clients call <span className="font-mono">model: &quot;auto&quot;</span>. Simple and coding prompts use the
            default model; complex prompts follow the strategy below.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {isLoading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-40 rounded bg-bg-tertiary" />
              <div className="h-10 w-full rounded bg-bg-tertiary" />
              <div className="h-10 w-full rounded bg-bg-tertiary" />
            </div>
          )}

          {isError && (
            <p className="text-sm text-error">Could not load auto-router settings.</p>
          )}

          {config && (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">Enable auto routing</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    When off, requests with model auto return not found.
                  </p>
                </div>
                <Toggle
                  checked={enabled}
                  onChange={(v) => {
                    setEnabled(v)
                    markDirty()
                  }}
                  aria-label="Enable auto routing"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Default model
                </label>
                <p className="text-xs text-text-tertiary">
                  Used for everyday chat and coding prompts (classifier uses this when unsure unless overridden).
                </p>
                <Select
                  value={defaultModel}
                  onChange={(v) => {
                    setDefaultModel(v)
                    if (!classifierModel || classifierModel === config.default_model) {
                      setClassifierModel(v)
                    }
                    markDirty()
                  }}
                  options={modelOptions}
                  searchable={modelOptions.length > 8}
                  placeholder="Select default model"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Complex prompts
                </label>
                <p className="text-xs text-text-tertiary">
                  Architecture, long reasoning, multi-step design, and similar hard prompts.
                </p>
                <Select
                  value={complexMode}
                  onChange={(v) => {
                    setComplexMode(v as ComplexMode)
                    markDirty()
                  }}
                  options={COMPLEX_OPTIONS}
                />
              </div>

              {complexMode === 'fixed' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Complex model
                  </label>
                  <Select
                    value={complexModel}
                    onChange={(v) => {
                      setComplexModel(v)
                      markDirty()
                    }}
                    options={modelOptions}
                    searchable={modelOptions.length > 8}
                    placeholder="Select model for complex prompts"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Classifier model
                </label>
                <p className="text-xs text-text-tertiary">
                  Small helper call when heuristics are unsure. Usually same as the default model.
                </p>
                <Select
                  value={classifierModel}
                  onChange={(v) => {
                    setClassifierModel(v)
                    markDirty()
                  }}
                  options={modelOptions}
                  searchable={modelOptions.length > 8}
                  placeholder="Select classifier model"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
