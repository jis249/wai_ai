import React from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { CopyButton } from '../../components/ui/CopyButton'
import { totalTokens, type RequestLogRow } from '../../hooks/useRequestLogs'
import { formatCost, formatDate, formatNumber } from '../../lib/utils'
import { CacheHitBadge, RequestStatusBadge } from './requestLogStatus'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wider text-text-tertiary">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary break-words">{children}</dd>
    </div>
  )
}

export interface RequestLogDetailSheetProps {
  row: RequestLogRow | null
  onClose: () => void
}

export function RequestLogDetailSheet({ row, onClose }: RequestLogDetailSheetProps) {
  return (
    <Sheet
      open={row != null}
      onClose={onClose}
      title="Request details"
      description={row != null ? formatDate(row.created_at) : undefined}
    >
      {row != null && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={row.status} />
            {row.cache_hit && <CacheHitBadge />}
          </div>

          {row.error && (
            <div role="alert" className="rounded-lg border border-error/20 bg-error/10 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-error">Error</p>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-text-primary">{row.error}</p>
            </div>
          )}

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Requested model">{row.model || '—'}</Field>
            <Field label="Routed model">
              {row.routed_model || '—'}
              {row.routed_model && row.model && row.routed_model !== row.model && (
                <span className="ml-1 text-xs text-text-tertiary">(routed)</span>
              )}
            </Field>
            <Field label="Prompt tokens">{formatNumber(row.prompt_tokens || 0)}</Field>
            <Field label="Completion tokens">{formatNumber(row.completion_tokens || 0)}</Field>
            <Field label="Total tokens">{formatNumber(totalTokens(row))}</Field>
            <Field label="Cost">{formatCost(row.cost_usd || 0)}</Field>
            <Field label="Latency">{formatNumber(row.latency_ms || 0)} ms</Field>
            <Field label="API key">
              <span className="font-mono text-xs">{row.key_hint || '—'}</span>
            </Field>
          </dl>

          <div>
            <p className="text-xs uppercase tracking-wider text-text-tertiary">Request ID</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all rounded bg-bg-tertiary px-2 py-1 font-mono text-xs text-text-primary">
                {row.id}
              </code>
              <CopyButton text={row.id} aria-label="Copy request ID" />
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}
