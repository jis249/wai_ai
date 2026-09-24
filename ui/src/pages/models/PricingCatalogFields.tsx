import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Toggle } from '../../components/ui/Toggle'
import { TimeAgo } from '../../components/ui/TimeAgo'
import { CircleCheck, Search, TriangleAlert } from '../../components/ui/icons'
import { usePricingLookup } from '../../hooks/usePricingSync'
import type { PricingSource } from '../../hooks/usePricingSync'
import { errorMessage } from '../../lib/errors'
import { formatPer1m } from './pricingFormat'
import type { ModelFormPatch, ModelFormValues } from './modelHelpers'

export interface PricingCatalogState {
  pricingKey: string
  pricingSource: PricingSource
}

export interface PricingCatalogFieldsProps {
  values: ModelFormValues
  onChange: (patch: ModelFormPatch) => void
  state: PricingCatalogState
  onStateChange: (patch: Partial<PricingCatalogState>) => void
  /** Existing model (edit): lookups also consider its deployments. */
  modelId?: string
  syncedAt?: string
  disabled?: boolean
}

/** Catalog pricing controls inside the Pricing section: source badge, key override, look up. */
export function PricingCatalogFields({
  values,
  onChange,
  state,
  onStateChange,
  modelId,
  syncedAt,
  disabled,
}: PricingCatalogFieldsProps) {
  const lookup = usePricingLookup()
  const result = lookup.data
  const canLookup = !!(state.pricingKey.trim() || values.name.trim() || modelId)

  function handleLookup() {
    lookup.mutate({
      key: state.pricingKey.trim(),
      name: values.name.trim() || undefined,
      provider: values.provider || undefined,
      azure_deployment: values.azureDeployment.trim() || undefined,
      model_id: modelId,
    })
  }

  function applyCatalogPrices() {
    if (!result?.found) return
    const patch: ModelFormPatch = {}
    if (result.input_per_1m != null) patch.inputPrice = String(result.input_per_1m)
    if (result.output_per_1m != null) patch.outputPrice = String(result.output_per_1m)
    if (!values.maxContextTokens.trim() && result.context_window) {
      patch.maxContextTokens = String(result.context_window)
    }
    onChange(patch)
  }

  return (
    <div className="min-w-0 space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
        <span>Pricing source</span>
        <Badge variant={state.pricingSource === 'synced' ? 'info' : 'muted'}>
          {state.pricingSource === 'synced' ? 'Synced' : 'Manual'}
        </Badge>
        {state.pricingSource === 'synced' && syncedAt ? (
          <span>
            last synced <TimeAgo date={syncedAt} />
          </span>
        ) : null}
      </div>
      <Toggle
        size="sm"
        checked={state.pricingSource === 'synced'}
        onChange={(on) => onStateChange({ pricingSource: on ? 'synced' : 'manual' })}
        disabled={disabled}
        label="Keep synced with the catalog"
        aria-label="Keep synced with the catalog"
      />
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <Input
            label="Catalog pricing key"
            value={state.pricingKey}
            onChange={(e) => {
              onStateChange({ pricingKey: e.target.value })
              lookup.reset()
            }}
            placeholder="Auto (match by name)"
            description="Optional LiteLLM key override, e.g. azure/gpt-4o-mini."
            maxLength={200}
            disabled={disabled}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="sm:mt-7"
          icon={<Search className="h-4 w-4" aria-hidden="true" />}
          loading={lookup.isPending}
          disabled={disabled || !canLookup}
          onClick={handleLookup}
        >
          Look up
        </Button>
      </div>
      <div aria-live="polite" className="min-w-0">
        {lookup.isError && (
          <p className="inline-flex items-start gap-1 text-xs text-error break-words" role="alert">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {errorMessage(lookup.error, 'Lookup failed')}
          </p>
        )}
        {result && !result.found && (
          <p className="text-xs text-text-tertiary break-words">
            No catalog match{result.tried.length > 0 ? ` (tried ${result.tried.slice(0, 4).join(', ')}${result.tried.length > 4 ? '…' : ''})` : ''}.
          </p>
        )}
        {result?.found && (
          <div className="rounded-lg border border-border bg-bg-tertiary/40 px-3 py-2 text-xs">
            <p className="inline-flex min-w-0 flex-wrap items-center gap-1 text-text-secondary">
              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>Match:</span>
              <span className="font-mono break-all text-text-primary">{result.match_key}</span>
            </p>
            {result.has_price ? (
              <p className="mt-1 text-text-tertiary">
                Input {formatPer1m(result.input_per_1m)} · Output {formatPer1m(result.output_per_1m)} per 1M
                {result.context_window ? ` · ${result.context_window.toLocaleString()} ctx` : ''}
              </p>
            ) : (
              <p className="mt-1 text-text-tertiary">The catalog lists no price for this model.</p>
            )}
            {result.has_price && (
              <Button type="button" variant="ghost" size="sm" className="mt-1 -ml-3" onClick={applyCatalogPrices} disabled={disabled}>
                Use these prices
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
