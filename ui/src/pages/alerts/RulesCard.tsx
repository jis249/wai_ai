import { useId, useMemo, useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { QueryState } from '../../components/ui/QueryState'
import { EmptyState } from '../../components/ui/EmptyState'
import { SlidersHorizontal } from '../../components/ui/icons'
import { useAlertChannels, useAlertRules, useUpdateAlertRule } from '../../hooks/useAlerts'
import type { AlertChannel, AlertRule, AlertScope, AlertSeverity, UpdateAlertRuleParams } from '../../hooks/useAlerts'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { COOLDOWN_OPTIONS, RULE_META, SEVERITY_LABEL, cooldownLabel } from './alertMeta'

const SEVERITY_OPTIONS = (Object.keys(SEVERITY_LABEL) as AlertSeverity[]).map((s) => ({
  value: s,
  label: `${SEVERITY_LABEL[s]} and above`,
}))

interface Draft {
  enabled: boolean
  severity_min: AlertSeverity
  cooldown_seconds: number
  channel_ids: string[]
  thresholds: string
  threshold_pct: string
  min_requests: string
  window_minutes: string
  time: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function draftFrom(rule: AlertRule): Draft {
  const p = rule.params ?? {}
  const thresholds = Array.isArray(p.thresholds) ? (p.thresholds as unknown[]).map((t) => String(t)).join(', ') : '80, 100'
  return {
    enabled: rule.enabled,
    severity_min: rule.severity_min,
    cooldown_seconds: rule.cooldown_seconds,
    channel_ids: rule.channel_ids ?? [],
    thresholds,
    threshold_pct: String(num(p.threshold_pct, 10)),
    min_requests: String(num(p.min_requests, 20)),
    window_minutes: String(num(p.window_minutes, 15)),
    time: `${pad(num(p.hour_utc, 3))}:${pad(num(p.minute_utc, 30))}`,
  }
}

/** Build the PUT body, or return an error message. */
function buildParams(rule: AlertRule, d: Draft): { params?: UpdateAlertRuleParams; error?: string } {
  const out: UpdateAlertRuleParams = {
    enabled: d.enabled,
    severity_min: d.severity_min,
    cooldown_seconds: d.cooldown_seconds,
    channel_ids: d.channel_ids,
  }
  if (rule.kind === 'budget.threshold') {
    const parts = d.thresholds.split(/[\s,]+/).filter(Boolean).map(Number)
    if (parts.length === 0 || parts.length > 5 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 1000)) {
      return { error: 'Thresholds must be 1 to 5 whole percentages between 1 and 1000' }
    }
    out.params = { thresholds: parts }
  } else if (rule.kind === 'error_rate.high') {
    const pct = Number(d.threshold_pct)
    const min = Number(d.min_requests)
    const win = Number(d.window_minutes)
    if (!(pct >= 0.1 && pct <= 100)) return { error: 'Error rate threshold must be between 0.1 and 100%' }
    if (!(Number.isInteger(min) && min >= 1)) return { error: 'Minimum requests must be a whole number of at least 1' }
    if (!(Number.isInteger(win) && win >= 5 && win <= 120)) return { error: 'Window must be 5 to 120 minutes' }
    out.params = { threshold_pct: pct, min_requests: min, window_minutes: win }
  } else if (rule.kind === 'digest.daily') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(d.time)
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: 'Choose a time of day (UTC)' }
    out.params = { hour_utc: Number(m[1]), minute_utc: Number(m[2]) }
  }
  return { params: out }
}

function RuleEditor({ rule, channels, scope }: { rule: AlertRule; channels: AlertChannel[]; scope: AlertScope }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rule))
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateAlertRule(scope)
  const { toast } = useToast()
  const headingId = useId()
  const errorId = useId()
  const meta = RULE_META[rule.kind] ?? { label: rule.kind, description: '' }
  const initial = useMemo(() => JSON.stringify(draftFrom(rule)), [rule])
  const dirty = JSON.stringify(draft) !== initial
  const set = (p: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...p }))

  const cooldownOptions = COOLDOWN_OPTIONS.some((o) => Number(o.value) === draft.cooldown_seconds)
    ? COOLDOWN_OPTIONS
    : [...COOLDOWN_OPTIONS, { value: String(draft.cooldown_seconds), label: cooldownLabel(draft.cooldown_seconds) }]

  function save(e: React.FormEvent) {
    e.preventDefault()
    const built = buildParams(rule, draft)
    if (built.error || !built.params) {
      setError(built.error ?? 'Invalid rule')
      return
    }
    setError(null)
    update.mutate(
      { kind: rule.kind, params: built.params },
      {
        onSuccess: (saved) => {
          setDraft(draftFrom(saved))
          toast({ variant: 'success', message: `${meta.label} saved` })
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to save rule') }),
      },
    )
  }

  const pending = update.isPending
  const showCooldown = rule.kind !== 'budget.threshold' && rule.kind !== 'digest.daily'

  return (
    <form
      onSubmit={save}
      aria-labelledby={headingId}
      className="rounded-lg border border-border p-4"
      noValidate
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="font-medium text-text-primary">
            {meta.label}
          </h3>
          <p className="mt-1 text-sm text-text-secondary">{meta.description}</p>
        </div>
        <Toggle
          checked={draft.enabled}
          onChange={(v) => set({ enabled: v })}
          aria-label={`${meta.label} enabled`}
          disabled={pending}
          className="mt-0.5 shrink-0"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rule.kind === 'budget.threshold' && (
          <Input
            label="Thresholds (% of monthly limit)"
            value={draft.thresholds}
            onChange={(e) => set({ thresholds: e.target.value })}
            inputMode="numeric"
            description="Comma-separated, e.g. 80, 100"
            disabled={pending}
          />
        )}
        {rule.kind === 'error_rate.high' && (
          <>
            <Input
              label="Error rate threshold (%)"
              type="number"
              min={0.1}
              max={100}
              step="any"
              value={draft.threshold_pct}
              onChange={(e) => set({ threshold_pct: e.target.value })}
              disabled={pending}
            />
            <Input
              label="Minimum requests"
              type="number"
              min={1}
              value={draft.min_requests}
              onChange={(e) => set({ min_requests: e.target.value })}
              disabled={pending}
            />
            <Input
              label="Window (minutes)"
              type="number"
              min={5}
              max={120}
              value={draft.window_minutes}
              onChange={(e) => set({ window_minutes: e.target.value })}
              disabled={pending}
            />
          </>
        )}
        {rule.kind === 'digest.daily' && (
          <Input
            label="Send at (UTC)"
            type="time"
            value={draft.time}
            onChange={(e) => set({ time: e.target.value })}
            description="03:30 UTC is 09:00 IST"
            disabled={pending}
          />
        )}
        <Select
          label="Minimum severity"
          options={SEVERITY_OPTIONS}
          value={draft.severity_min}
          onChange={(v) => set({ severity_min: v as AlertSeverity })}
          disabled={pending}
        />
        {showCooldown && (
          <Select
            label="Repeat cooldown"
            options={cooldownOptions}
            value={String(draft.cooldown_seconds)}
            onChange={(v) => set({ cooldown_seconds: Number(v) })}
            disabled={pending}
          />
        )}
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-sm font-medium text-text-secondary">Channels</legend>
        {channels.length === 0 ? (
          <p className="text-sm text-text-tertiary">No channels in this scope yet. Events are still recorded.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-text-tertiary">Leave all unchecked to use every enabled channel.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {channels.map((ch) => (
                <label key={ch.id} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    className="accent-accent h-4 w-4 shrink-0 cursor-pointer"
                    checked={draft.channel_ids.includes(ch.id)}
                    onChange={(e) =>
                      set({
                        channel_ids: e.target.checked
                          ? [...draft.channel_ids, ch.id]
                          : draft.channel_ids.filter((id) => id !== ch.id),
                      })
                    }
                    disabled={pending}
                  />
                  <span className="truncate">{ch.name}</span>
                  {!ch.enabled && <span className="text-xs text-text-tertiary">(disabled)</span>}
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>

      {error && (
        <p id={errorId} role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(draftFrom(rule))
              setError(null)
            }}
            disabled={pending}
          >
            Reset
          </Button>
        )}
        <Button type="submit" size="sm" loading={pending} disabled={!dirty} aria-describedby={error ? errorId : undefined}>
          Save
        </Button>
      </div>
    </form>
  )
}

export function RulesCard({ scope }: { scope: AlertScope }) {
  const rules = useAlertRules(scope)
  const channels = useAlertChannels(scope)
  const channelList = channels.data?.data ?? []
  return (
    <Card as="section" aria-labelledby="alert-rules-heading">
      <CardHeader
        title={<span id="alert-rules-heading">Rules</span>}
        description="Choose which alerts fire, how severe they must be and where they go. Critical alerts from organizations are also sent to platform channels."
      />
      <QueryState
        query={rules}
        errorTitle="Couldn't load rules"
        empty={<EmptyState icon={<SlidersHorizontal className="h-6 w-6" />} title="No rules for this scope" />}
      >
        {(data) => (
          <div className="space-y-4">
            {data.data.map((rule) => (
              <RuleEditor key={`${rule.kind}:${rule.updated_at}`} rule={rule} channels={channelList} scope={scope} />
            ))}
          </div>
        )}
      </QueryState>
    </Card>
  )
}
