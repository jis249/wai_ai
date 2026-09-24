import React, { useId, useMemo, useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { useModels, useUpdateModel } from '../../hooks/useModels'
import type { ModelResponse, UpdateModelParams } from '../../hooks/useModels'
import { useServerConfig } from '../../hooks/useServerConfig'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { usePricingSettings, useUpdatePricingSettings } from '../../hooks/usePricingSync'
import { PricingCatalogFields } from './PricingCatalogFields'
import type { PricingCatalogState } from './PricingCatalogFields'
import {
  BasicsSection,
  ConnectionSection,
  FallbackSection,
  LimitsSection,
  PricingSection,
} from './ModelFormSections'
import { buildFallbackOptions, modelToForm, normalizeAliases } from './modelHelpers'
import type { ModelFormPatch, ModelFormValues } from './modelHelpers'

export interface EditModelSheetProps {
  model: ModelResponse
  onClose: () => void
}

/** Diff of the form against the model: only changed fields are sent (PATCH). */
function buildUpdateParams(model: ModelResponse, v: ModelFormValues): UpdateModelParams {
  const params: UpdateModelParams = {}
  const isAzure = v.provider === 'azure'

  if (v.name.trim() !== model.name) params.name = v.name.trim()
  if (v.provider !== model.provider) params.provider = v.provider
  if (v.type !== (model.type || 'chat')) params.type = v.type
  if (v.baseUrl.trim() !== model.base_url) params.base_url = v.baseUrl.trim()
  if (v.apiKey.trim()) params.api_key = v.apiKey.trim()

  if (v.maxContextTokens.trim()) {
    const parsed = parseInt(v.maxContextTokens, 10)
    if (!isNaN(parsed) && parsed !== model.max_context_tokens) params.max_context_tokens = parsed
  } else if (model.max_context_tokens > 0) {
    params.max_context_tokens = 0
  }

  if (v.inputPrice.trim()) {
    const parsed = parseFloat(v.inputPrice)
    if (!isNaN(parsed) && parsed !== model.input_price_per_1m) params.input_price_per_1m = parsed
  } else if (model.input_price_per_1m > 0) {
    params.input_price_per_1m = 0
  }

  if (v.outputPrice.trim()) {
    const parsed = parseFloat(v.outputPrice)
    if (!isNaN(parsed) && parsed !== model.output_price_per_1m) params.output_price_per_1m = parsed
  } else if (model.output_price_per_1m > 0) {
    params.output_price_per_1m = 0
  }

  if (isAzure) {
    if (v.azureDeployment.trim() !== (model.azure_deployment ?? '')) {
      params.azure_deployment = v.azureDeployment.trim()
    }
    if (v.azureApiVersion.trim() !== (model.azure_api_version ?? '')) {
      params.azure_api_version = v.azureApiVersion.trim()
    }
  }

  const trimmedTimeout = v.timeout.trim()
  if (trimmedTimeout !== (model.timeout ?? '')) {
    params.timeout = trimmedTimeout || undefined
  }

  const newAliases = normalizeAliases(v.aliases)
  const sortedNew = [...newAliases].sort()
  const sortedOld = [...(model.aliases ?? [])].sort()
  if (JSON.stringify(sortedNew) !== JSON.stringify(sortedOld)) {
    params.aliases = newAliases
  }

  if (v.fallbackModelName !== (model.fallback_model_name ?? '')) {
    // Empty string tells the backend to clear the fallback.
    params.fallback_model_name = v.fallbackModelName || ''
  }

  return params
}

export function EditModelSheet({ model, onClose }: EditModelSheetProps) {
  const formId = useId()
  const [values, setValues] = useState<ModelFormValues>(() => modelToForm(model))

  const updateModel = useUpdateModel()
  const pricingSettings = usePricingSettings(model.id)
  const updatePricing = useUpdatePricingSettings()
  // Local edits layered over the saved catalog settings (null until they load).
  const [pricingEdits, setPricingEdits] = useState<Partial<PricingCatalogState>>({})
  const pricing: PricingCatalogState | null = pricingSettings.data
    ? {
        pricingKey: pricingSettings.data.pricing_key ?? '',
        pricingSource: pricingSettings.data.pricing_source === 'synced' ? 'synced' : 'manual',
        ...pricingEdits,
      }
    : null
  const { toast } = useToast()
  const { data: serverConfig } = useServerConfig()
  const { data: modelsData } = useModels()
  const fallbackEnabled = (serverConfig?.fallback_max_depth ?? 0) > 0
  const isPending = updateModel.isPending || updatePricing.isPending

  const fallbackOptions = useMemo(
    () => buildFallbackOptions(modelsData?.data ?? [], values.name, values.type),
    [modelsData, values.name, values.type],
  )

  function patch(p: ModelFormPatch) {
    setValues((prev) => ({ ...prev, ...p }))
  }

  async function handleSubmit(e: React.FormEvent | React.MouseEvent) {
    e.preventDefault()
    const params = buildUpdateParams(model, values)
    const saved = pricingSettings.data
    const pricingParams: { pricing_source?: 'manual' | 'synced'; pricing_key?: string } = {}
    if (pricing && saved) {
      const savedSource = saved.pricing_source === 'synced' ? 'synced' : 'manual'
      if (pricing.pricingSource !== savedSource) pricingParams.pricing_source = pricing.pricingSource
      if (pricing.pricingKey.trim() !== (saved.pricing_key ?? '')) pricingParams.pricing_key = pricing.pricingKey.trim()
    }
    if (Object.keys(params).length === 0 && Object.keys(pricingParams).length === 0) {
      onClose()
      return
    }
    try {
      if (Object.keys(params).length > 0) await updateModel.mutateAsync({ modelId: model.id, params })
      if (Object.keys(pricingParams).length > 0) {
        await updatePricing.mutateAsync({ modelId: model.id, params: pricingParams })
      }
      toast({ variant: 'success', message: 'Model updated' })
      onClose()
    } catch (err) {
      toast({ variant: 'error', message: errorMessage(err, 'Update failed') })
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      title="Edit Model"
      description={<span className="font-mono">{model.name}</span>}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isPending}>
            Save Changes
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-6" noValidate>
        <BasicsSection values={values} onChange={patch} disabled={isPending} />
        <ConnectionSection values={values} onChange={patch} disabled={isPending} isEdit />
        <PricingSection values={values} onChange={patch} disabled={isPending}>
          {pricing ? (
            <PricingCatalogFields
              values={values}
              onChange={patch}
              state={pricing}
              onStateChange={(p) => setPricingEdits((prev) => ({ ...prev, ...p }))}
              modelId={model.id}
              syncedAt={pricingSettings.data?.pricing_synced_at}
              disabled={isPending}
            />
          ) : pricingSettings.isError ? (
            <p className="text-xs text-text-tertiary sm:col-span-2" role="status">
              Catalog pricing settings unavailable: {errorMessage(pricingSettings.error, 'failed to load')}
            </p>
          ) : (
            <p className="text-xs text-text-tertiary sm:col-span-2" role="status" aria-busy="true">
              Loading catalog pricing settings…
            </p>
          )}
        </PricingSection>
        <LimitsSection values={values} onChange={patch} disabled={isPending} />
        <FallbackSection
          values={values}
          onChange={patch}
          disabled={isPending}
          options={fallbackOptions}
          fallbackEnabled={fallbackEnabled}
        />
      </form>
    </Sheet>
  )
}
