import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { SkeletonText } from '../../components/ui/Skeleton'
import { TimeAgo } from '../../components/ui/TimeAgo'
import { DollarSign, RefreshCw, Search, TriangleAlert } from '../../components/ui/icons'
import {
  useApplyPricing,
  usePricingPreview,
  usePricingStatus,
  useRefreshPricingPreview,
  useUpdatePricingSettings,
} from '../../hooks/usePricingSync'
import type { PricingAction, PricingPreviewRow } from '../../hooks/usePricingSync'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { cn } from '../../lib/utils'
import {
  ACTION_BADGE,
  ACTION_LABELS,
  isSelectable,
  priceChange,
  rowMatchesSearch,
} from './pricingFormat'

export interface PricingSyncSheetProps {
  onClose: () => void
}

type ActionFilter = 'all' | PricingAction

const FILTER_OPTIONS: { value: ActionFilter; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'update', label: 'Update' },
  { value: 'manual_locked', label: 'Manual (locked)' },
  { value: 'unchanged', label: 'Unchanged' },
  { value: 'no_match', label: 'No match' },
]

function PriceLine({ label, current, next }: { label: string; current: number; next: number | null }) {
  const change = priceChange(current, next)
  if (!change) return null
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs">
      <span className="text-text-tertiary">{label}</span>
      <span className="font-mono text-text-secondary">{change.from}</span>
      <span aria-hidden="true" className="text-text-tertiary">→</span>
      <span className="sr-only">to</span>
      <span className="font-mono text-text-primary">{change.to}</span>
      {change.direction !== 'same' && (
        <span className={change.direction === 'up' ? 'text-warning' : 'text-success'}>
          ({change.direction} {change.delta})
        </span>
      )}
    </div>
  )
}

function StatusLine() {
  const status = usePricingStatus()
  if (status.isPending) return <SkeletonText lines={1} />
  if (status.isError || !status.data) {
    return <p className="text-xs text-text-tertiary">Sync status unavailable.</p>
  }
  const s = status.data
  return (
    <div className="space-y-1 text-xs text-text-tertiary" role="status">
      <p className="break-words">
        Last synced:{' '}
        {s.last_sync_at ? <TimeAgo date={s.last_sync_at} /> : <span>never</span>}
        {' · '}Source: <span className="font-mono break-all">{s.source_kind === 'file' ? s.source : 'LiteLLM price list'}</span>
        {' · '}Auto-sync: {s.auto_sync ? `on (every ${s.auto_sync_interval_hours}h, ${s.synced_models} synced)` : 'off'}
      </p>
      {s.last_error && (
        <p className="inline-flex items-start gap-1 text-warning break-words">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Last error{s.last_error_at ? <> (<TimeAgo date={s.last_error_at} />)</> : null}: {s.last_error}
          </span>
        </p>
      )}
    </div>
  )
}

interface RowProps {
  row: PricingPreviewRow
  checked: boolean
  onCheck: (checked: boolean) => void
  onKeepSynced: (synced: boolean) => void
  savingSync: boolean
}

function PreviewRowItem({ row, checked, onCheck, onKeepSynced, savingSync }: RowProps) {
  const checkId = useId()
  const selectable = isSelectable(row)
  return (
    <li className="flex min-w-0 gap-3 border-b border-border py-3 last:border-b-0">
      <div className="pt-0.5">
        <input
          id={checkId}
          type="checkbox"
          className="h-4 w-4 accent-accent cursor-pointer disabled:opacity-40"
          checked={checked}
          disabled={!selectable}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={`Select ${row.name}`}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label htmlFor={checkId} className="min-w-0 break-all font-mono text-sm text-text-primary">
            {row.name}
          </label>
          <Badge variant={ACTION_BADGE[row.action]}>{ACTION_LABELS[row.action]}</Badge>
          {row.pricing_source === 'synced' && <Badge variant="info">Synced</Badge>}
        </div>
        <p className="break-all text-xs text-text-tertiary">
          {row.match_key ? (
            <>
              Catalog: <span className="font-mono">{row.match_key}</span>
              {row.matched_via === 'pricing_key' && ' (pricing key)'}
            </>
          ) : (
            'No catalog match'
          )}
        </p>
        {row.catalog_input_per_1m != null && (
          <div className="space-y-0.5">
            <PriceLine label="Input /1M" current={row.current_input_per_1m} next={row.catalog_input_per_1m} />
            <PriceLine label="Output /1M" current={row.current_output_per_1m} next={row.catalog_output_per_1m} />
          </div>
        )}
        {row.note && <p className="text-xs text-text-tertiary break-words">{row.note}</p>}
        {row.action !== 'no_match' && (
          <Toggle
            size="sm"
            checked={row.pricing_source === 'synced'}
            onChange={onKeepSynced}
            disabled={savingSync}
            label="Keep synced"
            aria-label={`Keep ${row.name} synced with the catalog`}
          />
        )}
      </div>
    </li>
  )
}

export function PricingSyncSheet({ onClose }: PricingSyncSheetProps) {
  const preview = usePricingPreview()
  const refresh = useRefreshPricingPreview()
  const apply = useApplyPricing()
  const updateSettings = useUpdatePricingSettings()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ActionFilter>('all')
  // null = untouched: preselect the rows the sync would update anyway (never manual_locked).
  const [selectedState, setSelected] = useState<Set<string> | null>(null)
  const [lockToSynced, setLockToSynced] = useState(false)
  // Optimistic "Keep synced" values until the preview refetches.
  const [syncOverrides, setSyncOverrides] = useState<Record<string, boolean>>({})

  const rows = useMemo(
    () =>
      (preview.data?.rows ?? []).map((r) =>
        r.model_id in syncOverrides
          ? { ...r, pricing_source: syncOverrides[r.model_id] ? ('synced' as const) : ('manual' as const) }
          : r,
      ),
    [preview.data, syncOverrides],
  )

  const selected = useMemo(
    () =>
      selectedState ??
      new Set((preview.data?.rows ?? []).filter((r) => r.action === 'update').map((r) => r.model_id)),
    [selectedState, preview.data],
  )

  const visible = useMemo(
    () => rows.filter((r) => (filter === 'all' || r.action === filter) && rowMatchesSearch(r, search)),
    [rows, filter, search],
  )
  const visibleSelectable = visible.filter(isSelectable)
  const selectedIds = rows.filter((r) => selected.has(r.model_id) && isSelectable(r)).map((r) => r.model_id)
  const allVisibleChecked =
    visibleSelectable.length > 0 && visibleSelectable.every((r) => selected.has(r.model_id))
  const counts = preview.data?.counts

  function toggle(id: string, on: boolean) {
    setSelected(() => {
      const next = new Set(selected)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAllVisible(on: boolean) {
    setSelected(() => {
      const next = new Set(selected)
      for (const r of visibleSelectable) {
        if (on) next.add(r.model_id)
        else next.delete(r.model_id)
      }
      return next
    })
  }

  function handleKeepSynced(row: PricingPreviewRow, synced: boolean) {
    setSyncOverrides((prev) => ({ ...prev, [row.model_id]: synced }))
    updateSettings.mutate(
      { modelId: row.model_id, params: { pricing_source: synced ? 'synced' : 'manual' } },
      {
        onError: (err) => {
          setSyncOverrides((prev) => {
            const next = { ...prev }
            delete next[row.model_id]
            return next
          })
          toast({ variant: 'error', message: errorMessage(err, 'Failed to update pricing source') })
        },
      },
    )
  }

  function handleRefresh() {
    refresh.mutate(undefined, {
      onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Could not refresh the price list') }),
    })
  }

  function handleApply() {
    if (selectedIds.length === 0) return
    apply.mutate(
      { model_ids: selectedIds, lock_to_synced: lockToSynced },
      {
        onSuccess: (res) => {
          const n = res.updated.length
          toast({
            variant: 'success',
            message: n === 0 ? 'No prices changed' : `Updated pricing for ${n} model${n === 1 ? '' : 's'}`,
          })
          setSelected(new Set())
          setSyncOverrides({})
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to apply pricing') }),
      },
    )
  }

  let body: ReactNode
  if (preview.isPending) {
    body = (
      <div aria-busy="true" aria-label="Loading price preview">
        <SkeletonText lines={6} />
      </div>
    )
  } else if (preview.isError && !preview.data) {
    body = (
      <ErrorState
        title="Couldn't load the price list"
        error={preview.error}
        onRetry={() => void preview.refetch()}
        retrying={preview.isFetching}
      />
    )
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={<DollarSign className="h-6 w-6" />}
        title="No models to price"
        description="Add a model first, then sync its pricing from the catalog."
      />
    )
  } else {
    body = (
      <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search models"
              placeholder="Search name, provider, catalog key…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="sm:w-48">
            <Select
              options={FILTER_OPTIONS.map((o) => ({
                value: o.value,
                label: o.value !== 'all' && counts ? `${o.label} (${counts[o.value] ?? 0})` : o.label,
              }))}
              value={filter}
              onChange={(v) => setFilter(v as ActionFilter)}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
          <label className={cn('inline-flex items-center gap-2', visibleSelectable.length === 0 && 'opacity-50')}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent cursor-pointer"
              checked={allVisibleChecked}
              disabled={visibleSelectable.length === 0}
              onChange={(e) => toggleAllVisible(e.target.checked)}
            />
            Select all shown
          </label>
          <span role="status">
            {visible.length} of {rows.length} models · {preview.data?.entries ?? 0} catalog entries
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No matching models"
            secondaryAction={{
              label: 'Clear filters',
              onClick: () => {
                setSearch('')
                setFilter('all')
              },
            }}
          />
        ) : (
          <ul className="mt-2" aria-label="Pricing preview">
            {visible.map((r) => (
              <PreviewRowItem
                key={r.model_id}
                row={r}
                checked={selected.has(r.model_id) && isSelectable(r)}
                onCheck={(on) => toggle(r.model_id, on)}
                onKeepSynced={(on) => handleKeepSynced(r, on)}
                savingSync={updateSettings.isPending && updateSettings.variables?.modelId === r.model_id}
              />
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      title="Sync pricing"
      description="Compare model prices with the LiteLLM community price list. Nothing changes until you apply."
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          loading={refresh.isPending}
          onClick={handleRefresh}
          aria-label="Refresh price list"
        >
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      }
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Toggle
            size="sm"
            checked={lockToSynced}
            onChange={setLockToSynced}
            label="Keep applied models synced"
            aria-label="Keep applied models synced"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={apply.isPending}>
              Close
            </Button>
            <Button onClick={handleApply} loading={apply.isPending} disabled={selectedIds.length === 0}>
              Apply selected ({selectedIds.length})
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <StatusLine />
        <div>{body}</div>
      </div>
    </Sheet>
  )
}
