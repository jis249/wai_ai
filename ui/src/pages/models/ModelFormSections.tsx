import React, { useId } from 'react'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import type { SelectOption } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { CircleCheck, CircleX, Plug, TriangleAlert } from '../../components/ui/icons'
import { cn } from '../../lib/utils'
import { AliasInput } from './AliasInput'
import {
  MODEL_TYPE_OPTIONS,
  PROVIDER_OPTIONS,
  STRATEGY_OPTIONS,
  baseUrlPlaceholder,
} from './modelHelpers'
import type { ModelFormPatch, ModelFormValues } from './modelHelpers'

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

export interface FormSectionProps {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  /** Grid columns at sm+ (default 2). Children can span with `sm:col-span-2`. */
  columns?: 1 | 2
  className?: string
}

/** Titled group of fields; 1 column on phones, 2 from `sm`. */
export function FormSection({ title, description, children, columns = 2, className }: FormSectionProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 border-t border-border pt-5 first:border-t-0 first:pt-0', className)}
    >
      <h3 id={headingId} className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
        {title}
      </h3>
      {description != null && <p className="mt-1 text-xs text-text-tertiary">{description}</p>}
      <div className={cn('mt-3 grid grid-cols-1 gap-4', columns === 2 && 'sm:grid-cols-2')}>{children}</div>
    </section>
  )
}

interface SectionProps {
  values: ModelFormValues
  onChange: (patch: ModelFormPatch) => void
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Basics: name, type, aliases
// ---------------------------------------------------------------------------

export function BasicsSection({
  values,
  onChange,
  disabled,
  nameError,
}: SectionProps & { nameError?: string }) {
  return (
    <FormSection title="Basics">
      <Input
        label="Name"
        value={values.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="e.g. gpt-4o"
        error={nameError}
        disabled={disabled}
      />
      <Select
        label="Type"
        options={MODEL_TYPE_OPTIONS}
        value={values.type}
        onChange={(type) => onChange({ type })}
        disabled={disabled}
      />
      <AliasInput
        className="sm:col-span-2"
        value={values.aliases}
        onChange={(aliases) => onChange({ aliases })}
        description="Press Enter or comma to add. Must be globally unique."
        disabled={disabled}
      />
    </FormSection>
  )
}

// ---------------------------------------------------------------------------
// Connection: provider, base URL, API key, Azure fields, test connection
// ---------------------------------------------------------------------------

export interface ConnectionTestState {
  onTest: () => void
  testing: boolean
  result: { success: boolean; message: string } | null
}

export function ConnectionSection({
  values,
  onChange,
  disabled,
  isEdit = false,
  errors,
  test,
}: SectionProps & {
  isEdit?: boolean
  errors?: { base_url?: string }
  test?: ConnectionTestState
}) {
  const isAzure = values.provider === 'azure'
  return (
    <FormSection title="Connection">
      <Select
        label="Provider"
        options={PROVIDER_OPTIONS}
        value={values.provider}
        onChange={(provider) => onChange(isEdit ? { provider } : { provider, baseUrl: '' })}
        disabled={disabled}
      />
      <Input
        label="Base URL"
        value={values.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder={baseUrlPlaceholder(values.provider)}
        error={errors?.base_url}
        disabled={disabled}
      />
      <Input
        label="API Key"
        type="password"
        autoComplete="new-password"
        value={values.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder={isEdit ? 'Leave empty to keep current key' : 'sk-...'}
        description={
          isEdit
            ? 'Leave empty to keep current key. Enter a new value to replace.'
            : 'Encrypted at rest, never shown again'
        }
        disabled={disabled}
      />
      {test != null && (
        <div className="flex flex-wrap items-center gap-3 sm:pt-7">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Plug className="h-4 w-4" aria-hidden="true" />}
            loading={test.testing}
            disabled={!values.baseUrl.trim()}
            onClick={test.onTest}
          >
            Test Connection
          </Button>
          {test.result && (
            <span
              role="status"
              className={cn(
                'inline-flex min-w-0 items-center gap-1 text-sm break-words',
                test.result.success ? 'text-success' : 'text-error',
              )}
            >
              {test.result.success ? (
                <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <CircleX className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="sr-only">{test.result.success ? 'Success:' : 'Failed:'}</span>
              {test.result.message}
            </span>
          )}
        </div>
      )}
      {isAzure && (
        <>
          <Input
            label="Azure Deployment"
            value={values.azureDeployment}
            onChange={(e) => onChange({ azureDeployment: e.target.value })}
            placeholder="e.g. gpt-4o-deployment"
            disabled={disabled}
          />
          <Input
            label="Azure API Version"
            value={values.azureApiVersion}
            onChange={(e) => onChange({ azureApiVersion: e.target.value })}
            placeholder="e.g. 2024-02-01"
            disabled={disabled}
          />
        </>
      )}
    </FormSection>
  )
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export function PricingSection({
  values,
  onChange,
  disabled,
  children,
}: SectionProps & { /** Extra full-width content (catalog pricing controls). */ children?: React.ReactNode }) {
  return (
    <FormSection title="Pricing" description="USD per 1M tokens. Leave empty for no cost tracking.">
      <Input
        label="Input Price per 1M tokens"
        type="number"
        inputMode="decimal"
        value={values.inputPrice}
        onChange={(e) => onChange({ inputPrice: e.target.value })}
        placeholder="e.g. 2.50"
        disabled={disabled}
      />
      <Input
        label="Output Price per 1M tokens"
        type="number"
        inputMode="decimal"
        value={values.outputPrice}
        onChange={(e) => onChange({ outputPrice: e.target.value })}
        placeholder="e.g. 10.00"
        disabled={disabled}
      />
      {children}
    </FormSection>
  )
}

// ---------------------------------------------------------------------------
// Limits & routing
// ---------------------------------------------------------------------------

export function LimitsSection({
  values,
  onChange,
  disabled,
  showRouting = false,
}: SectionProps & { showRouting?: boolean }) {
  return (
    <FormSection title={showRouting ? 'Limits & routing' : 'Limits'}>
      <Input
        label="Max Context Tokens"
        type="number"
        inputMode="numeric"
        value={values.maxContextTokens}
        onChange={(e) => onChange({ maxContextTokens: e.target.value })}
        placeholder="e.g. 128000"
        disabled={disabled}
      />
      <Input
        label="Timeout"
        value={values.timeout}
        onChange={(e) => onChange({ timeout: e.target.value })}
        placeholder="e.g. 30s, 2m, 5m"
        description="Per-model upstream timeout. Empty = use global default."
        disabled={disabled}
      />
      {showRouting && (
        <>
          <Select
            label="Strategy"
            options={STRATEGY_OPTIONS}
            value={values.strategy}
            onChange={(strategy) => onChange({ strategy })}
            disabled={disabled}
          />
          <Input
            label="Max Retries"
            type="number"
            inputMode="numeric"
            value={values.maxRetries}
            onChange={(e) => onChange({ maxRetries: e.target.value })}
            placeholder="0"
            disabled={disabled}
          />
        </>
      )}
    </FormSection>
  )
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

export function FallbackSection({
  values,
  onChange,
  disabled,
  options,
  fallbackEnabled,
}: SectionProps & { options: SelectOption[]; fallbackEnabled: boolean }) {
  return (
    <FormSection title="Fallback" columns={1}>
      <div>
        <Select
          label="Fallback Model"
          options={options}
          value={values.fallbackModelName}
          onChange={(fallbackModelName) => onChange({ fallbackModelName })}
          disabled={disabled || !fallbackEnabled}
        />
        {fallbackEnabled ? (
          <p className="text-xs text-text-tertiary mt-1.5">
            When this model fails, requests automatically retry on the fallback model.
          </p>
        ) : (
          <p className="inline-flex items-start gap-1.5 text-xs text-warning mt-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
            Fallback is disabled. Set fallback_max_depth in your server config to enable.
          </p>
        )}
      </div>
    </FormSection>
  )
}
