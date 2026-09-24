import React from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { Lock } from '../ui/icons'
import { formatNumber } from '../../lib/utils'
import { parseLimit, parseSpend, type LimitsOptions, type LimitsValues } from './limits'

export const LIMITS_MANAGED_NOTE = 'Limits, spend caps and guardrails are managed by your system administrator.'

export interface LimitsFormProps extends LimitsOptions {
  values: LimitsValues
  onChange: (values: LimitsValues) => void
  /** Show values as text instead of inputs (e.g. org admins viewing system-admin-managed limits). */
  readOnly?: boolean
  /** Note shown above read-only values. */
  readOnlyNote?: React.ReactNode
  /** Disable inputs (e.g. while saving). */
  disabled?: boolean
}

type NumericField = 'dailyTokenLimit' | 'monthlyTokenLimit' | 'requestsPerMinute' | 'requestsPerDay'

const NUMERIC_FIELDS: { key: NumericField; label: string }[] = [
  { key: 'dailyTokenLimit', label: 'Daily token limit' },
  { key: 'monthlyTokenLimit', label: 'Monthly token limit' },
  { key: 'requestsPerMinute', label: 'Requests / minute' },
  { key: 'requestsPerDay', label: 'Requests / day' },
]

function unlimitedOr(n: number, fmt: (n: number) => string): string {
  return n === 0 ? 'Unlimited' : fmt(n)
}

function ReadOnlyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-tertiary">{label}</dt>
      <dd className="mt-1 break-words text-sm text-text-primary">{value}</dd>
    </div>
  )
}

/**
 * Token / request limits (+ optional spend cap and guardrails) with "0 = unlimited" help.
 * Controlled: parent owns `values` and builds API params with `limitsToParams`.
 */
export function LimitsForm({
  values,
  onChange,
  readOnly = false,
  readOnlyNote,
  disabled = false,
  spend = false,
  guardrails = false,
}: LimitsFormProps) {
  function set<K extends keyof LimitsValues>(key: K, value: LimitsValues[K]) {
    onChange({ ...values, [key]: value })
  }

  if (readOnly) {
    return (
      <div className="space-y-4">
        {readOnlyNote != null && (
          <p className="flex items-start gap-2 rounded-md border border-border bg-bg-tertiary/50 px-3 py-2 text-xs text-text-secondary">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{readOnlyNote}</span>
          </p>
        )}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {NUMERIC_FIELDS.map((f) => (
            <ReadOnlyValue key={f.key} label={f.label} value={unlimitedOr(parseLimit(values[f.key]), formatNumber)} />
          ))}
          {spend && (
            <ReadOnlyValue
              label="Monthly spend limit (USD)"
              value={unlimitedOr(parseSpend(values.monthlySpendLimit), (n) => `$${n.toFixed(2)}`)}
            />
          )}
          {guardrails && (
            <>
              <ReadOnlyValue label="Block obvious PII in prompts" value={values.guardrailPii ? 'On' : 'Off'} />
              <ReadOnlyValue label="Denied tool names" value={values.toolDenylist.trim() || 'None'} />
            </>
          )}
        </dl>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {NUMERIC_FIELDS.map((f) => (
          <Input
            key={f.key}
            label={f.label}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={values[f.key]}
            onChange={(e) => set(f.key, e.target.value)}
            description="0 = unlimited"
            disabled={disabled}
          />
        ))}
        {spend && (
          <Input
            label="Monthly spend limit (USD)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={values.monthlySpendLimit}
            onChange={(e) => set('monthlySpendLimit', e.target.value)}
            description="Requests are blocked once estimated spend reaches this amount. 0 = unlimited"
            disabled={disabled}
          />
        )}
      </div>
      {guardrails && (
        <div className="space-y-3 border-t border-border pt-4">
          <Toggle
            checked={values.guardrailPii}
            onChange={(checked) => set('guardrailPii', checked)}
            label="Block obvious PII (SSN / card numbers) in prompts"
            disabled={disabled}
          />
          <Input
            label="Denied tool names"
            value={values.toolDenylist}
            onChange={(e) => set('toolDenylist', e.target.value)}
            description="Comma-separated function/tool names to block"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}
