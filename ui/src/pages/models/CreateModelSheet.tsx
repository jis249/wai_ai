import React, { useMemo, useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import TabSwitcher from '../../components/ui/TabSwitcher'
import { useModels, useCreateModel, useCreateDeployment } from '../../hooks/useModels'
import type { CreateModelParams } from '../../hooks/useModels'
import { useServerConfig } from '../../hooks/useServerConfig'
import { useToast } from '../../hooks/useToast'
import apiClient from '../../api/client'
import { errorMessage } from '../../lib/errors'
import {
  BasicsSection,
  ConnectionSection,
  FallbackSection,
  FormSection,
  LimitsSection,
  PricingSection,
} from './ModelFormSections'
import { InlineDeploymentsEditor } from './InlineDeploymentsEditor'
import type { DeploymentEntry } from './DeploymentFields'
import {
  buildFallbackOptions,
  emptyModelForm,
  normalizeAliases,
  parseOptionalFloat,
  parseOptionalInt,
} from './modelHelpers'
import type { ModelFormPatch, ModelFormValues } from './modelHelpers'

type Mode = 'single' | 'loadbalanced'

interface FormErrors {
  name?: string
  provider?: string
  base_url?: string
  deployments?: string
}

export interface CreateModelSheetProps {
  onClose: () => void
}

/** "Add Model" side sheet. Mount it only while open so state starts fresh each time. */
export function CreateModelSheet({ onClose }: CreateModelSheetProps) {
  const [mode, setMode] = useState<Mode>('single')
  const [values, setValues] = useState<ModelFormValues>(emptyModelForm)
  const [deployments, setDeployments] = useState<DeploymentEntry[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const createModel = useCreateModel()
  const createDeployment = useCreateDeployment()
  const { toast } = useToast()
  const { data: serverConfig } = useServerConfig()
  const { data: modelsData } = useModels()
  const fallbackEnabled = (serverConfig?.fallback_max_depth ?? 0) > 0
  const isPending = createModel.isPending || createDeployment.isPending

  const fallbackOptions = useMemo(
    () => buildFallbackOptions(modelsData?.data ?? [], values.name, values.type),
    [modelsData, values.name, values.type],
  )

  function patch(p: ModelFormPatch) {
    setValues((prev) => ({ ...prev, ...p }))
    if ('provider' in p || 'baseUrl' in p || 'apiKey' in p) setTestResult(null)
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiClient<{ success: boolean; message: string }>('/models/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          provider: values.provider,
          base_url: values.baseUrl.trim(),
          api_key: values.apiKey.trim(),
        }),
      })
      setTestResult(res)
    } catch (err) {
      setTestResult({ success: false, message: errorMessage(err, 'Test failed') })
    } finally {
      setTesting(false)
    }
  }

  function validate(): boolean {
    const next: FormErrors = {}
    if (!values.name.trim()) next.name = 'Name is required'
    if (mode === 'single') {
      if (!values.provider) next.provider = 'Provider is required'
      if (!values.baseUrl.trim()) next.base_url = 'Base URL is required'
    } else if (deployments.length === 0) {
      next.deployments = 'At least one deployment is required'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  /** Fields common to both modes (same order/semantics as before the split). */
  function commonParams(params: CreateModelParams) {
    const maxContext = parseOptionalInt(values.maxContextTokens)
    if (maxContext !== undefined) params.max_context_tokens = maxContext
    const inputPrice = parseOptionalFloat(values.inputPrice)
    if (inputPrice !== undefined) params.input_price_per_1m = inputPrice
    const outputPrice = parseOptionalFloat(values.outputPrice)
    if (outputPrice !== undefined) params.output_price_per_1m = outputPrice
    return params
  }

  async function handleSubmit(e: React.MouseEvent) {
    e.preventDefault()
    if (!validate()) return

    const aliases = normalizeAliases(values.aliases)
    const timeout = values.timeout.trim()

    if (mode === 'single') {
      const params = commonParams({
        name: values.name.trim(),
        type: values.type,
        provider: values.provider,
        base_url: values.baseUrl.trim(),
      })
      if (values.apiKey.trim()) params.api_key = values.apiKey.trim()
      if (values.provider === 'azure') {
        if (values.azureDeployment.trim()) params.azure_deployment = values.azureDeployment.trim()
        if (values.azureApiVersion.trim()) params.azure_api_version = values.azureApiVersion.trim()
      }
      if (timeout) params.timeout = timeout
      if (aliases.length > 0) params.aliases = aliases

      createModel.mutate(params, {
        onSuccess: () => {
          toast({ variant: 'success', message: 'Model added' })
          onClose()
        },
        onError: (err) => {
          toast({ variant: 'error', message: errorMessage(err, 'Failed to add model') })
        },
      })
      return
    }

    const params: CreateModelParams = {
      name: values.name.trim(),
      type: values.type,
      strategy: values.strategy,
    }
    const maxRetries = parseOptionalInt(values.maxRetries)
    if (maxRetries !== undefined) params.max_retries = maxRetries
    if (values.fallbackModelName) params.fallback_model_name = values.fallbackModelName
    commonParams(params)
    if (timeout) params.timeout = timeout
    if (aliases.length > 0) params.aliases = aliases

    try {
      const model = await createModel.mutateAsync(params)
      for (const dep of deployments) {
        await createDeployment.mutateAsync({
          modelId: model.id,
          params: {
            name: dep.name,
            provider: dep.provider,
            base_url: dep.baseUrl,
            api_key: dep.apiKey || undefined,
            azure_deployment: dep.azureDeployment || undefined,
            azure_api_version: dep.azureApiVersion || undefined,
            weight: parseInt(dep.weight, 10) || 1,
            priority: parseInt(dep.priority, 10) || 0,
          },
        })
      }
      toast({ variant: 'success', message: 'Model added' })
      onClose()
    } catch (err) {
      toast({ variant: 'error', message: errorMessage(err, 'Failed to add model') })
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      title="Add Model"
      description="Register a single endpoint or a load-balanced group of deployments."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isPending}>
            Add Model
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <TabSwitcher
          className="flex w-full sm:inline-flex sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none"
          tabs={[
            { key: 'single', label: 'Single Endpoint' },
            { key: 'loadbalanced', label: 'Load Balanced' },
          ]}
          activeKey={mode}
          onChange={(key) => setMode(key as Mode)}
        />

        <BasicsSection values={values} onChange={patch} disabled={isPending} nameError={errors.name} />

        {mode === 'single' ? (
          <ConnectionSection
            values={values}
            onChange={patch}
            disabled={isPending}
            errors={errors}
            test={{ onTest: handleTestConnection, testing, result: testResult }}
          />
        ) : (
          <FormSection title="Deployments" description="Requests are spread across these endpoints.">
            <InlineDeploymentsEditor
              deployments={deployments}
              onChange={setDeployments}
              error={errors.deployments}
              disabled={isPending}
            />
          </FormSection>
        )}

        <PricingSection values={values} onChange={patch} disabled={isPending} />
        <LimitsSection values={values} onChange={patch} disabled={isPending} showRouting={mode === 'loadbalanced'} />

        {mode === 'loadbalanced' && (
          <FallbackSection
            values={values}
            onChange={patch}
            disabled={isPending}
            options={fallbackOptions}
            fallbackEnabled={fallbackEnabled}
          />
        )}
      </div>
    </Sheet>
  )
}
