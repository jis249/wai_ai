import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { QueryState } from '../../components/ui/QueryState'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { SkeletonRows } from '../../components/ui/Skeleton'
import { TimeAgo } from '../../components/ui/TimeAgo'
import { TimeRangePicker } from '../../components/ui/TimeRangePicker'
import { KeyRound, RefreshCw, ScrollText, Search, X } from '../../components/ui/icons'
import {
  totalTokens,
  useRequestLogs,
  type RequestLogRow,
  type RequestLogStatusFilter,
} from '../../hooks/useRequestLogs'
import { resolveProxyBaseUrl } from '../../lib/proxyUrl'
import {
  ALL_TIME_RANGE_PRESETS,
  getTimeRange,
  isCustomTimeRange,
  parseTimeRange,
  serializeTimeRange,
  type TimeRangeValue,
} from '../../lib/timeRange'
import { formatCost, formatDate, formatNumber } from '../../lib/utils'
import { RequestLogDetailSheet } from './RequestLogDetailSheet'
import { CacheHitBadge, RequestStatusBadge } from './requestLogStatus'

type StatusOption = 'all' | RequestLogStatusFilter
type TimeMode = 'any' | 'range'

const STATUS_OPTIONS = [
  { value: 'all' as const, label: 'All' },
  { value: 'success' as const, label: 'Success' },
  { value: 'error' as const, label: 'Errors' },
]

const TIME_MODE_OPTIONS = [
  { value: 'any' as const, label: 'Any time' },
  { value: 'range' as const, label: 'Range' },
]

const DEFAULT_RANGE: TimeRangeValue = '24h'
const MODEL_DEBOUNCE_MS = 350

const CURL_SNIPPET = `curl ${resolveProxyBaseUrl()}/chat/completions \\
  -H "Authorization: Bearer $WAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello"}]}'`

function parseStatus(raw: string | null): RequestLogStatusFilter | undefined {
  return raw === 'success' || raw === 'error' ? raw : undefined
}

export default function RequestLogsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const status = parseStatus(searchParams.get('status'))
  const model = searchParams.get('model') ?? ''
  const keyId = searchParams.get('key_id') ?? ''
  const range = parseTimeRange(searchParams.get('range'))

  const [modelDraft, setModelDraft] = useState(model)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<RequestLogRow | null>(null)

  function updateParams(changes: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v == null || v === '') next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true },
    )
  }

  // Keep the text box in sync when the URL changes externally (back/forward, "Clear filters").
  const [syncedModel, setSyncedModel] = useState(model)
  if (syncedModel !== model) {
    setSyncedModel(model)
    setModelDraft(model)
  }

  // Debounce model typing into the URL (and therefore the query).
  useEffect(() => {
    const trimmed = modelDraft.trim()
    if (trimmed === model) return
    const t = setTimeout(() => updateParams({ model: trimmed || null }), MODEL_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateParams is stable enough (uses functional update)
  }, [modelDraft, model])

  const rangeKey = range != null ? serializeTimeRange(range) : ''
  const bounds = useMemo(
    () => (range != null ? getTimeRange(range) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rangeKey captures range; refreshKey re-anchors presets to now
    [rangeKey, refreshKey],
  )

  const query = useRequestLogs({
    status,
    model: model || undefined,
    key_id: keyId || undefined,
    from: bounds?.from,
    to: bounds?.to,
  })

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data])
  const modelSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      if (r.model) set.add(r.model)
      if (r.routed_model) set.add(r.routed_model)
    }
    return [...set].sort()
  }, [rows])

  const hasFilters = status != null || model !== '' || keyId !== '' || range != null

  function clearFilters() {
    setModelDraft('')
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  function refresh() {
    if (range != null && !isCustomTimeRange(range)) setRefreshKey((k) => k + 1)
    else void query.refetch()
  }

  const emptyState = hasFilters ? (
    <EmptyState
      icon={<Search className="w-6 h-6" />}
      title="No matching requests"
      description="No proxy requests match these filters. Try widening the time range or clearing filters."
      action={{ label: 'Clear filters', onClick: clearFilters }}
    />
  ) : (
    <EmptyState
      icon={<ScrollText className="w-6 h-6" />}
      title="No requests yet"
      description="Requests sent through the proxy with an API key show up here. Send one to get started:"
      action={{ label: 'Create an API key', onClick: () => navigate('/keys'), icon: <KeyRound className="w-4 h-4" /> }}
    >
      <div className="w-full max-w-xl text-left">
        <div className="flex items-center justify-between gap-2 rounded-t-lg border border-b-0 border-border bg-bg-tertiary px-3 py-1.5">
          <span className="text-xs text-text-tertiary">curl</span>
          <CopyButton text={CURL_SNIPPET} aria-label="Copy curl example" />
        </div>
        <pre className="overflow-x-auto rounded-b-lg border border-border bg-bg-primary p-3 text-xs text-text-secondary">
          <code>{CURL_SNIPPET}</code>
        </pre>
      </div>
    </EmptyState>
  )

  return (
    <div className="min-w-0 space-y-4">
      {/* Filter toolbar */}
      <div
        role="search"
        aria-label="Filter request logs"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-secondary p-4"
      >
        <div className="min-w-0">
          <span id="rl-status-label" className="mb-1.5 block text-sm font-medium text-text-secondary">
            Status
          </span>
          <SegmentedControl<StatusOption>
            aria-labelledby="rl-status-label"
            options={STATUS_OPTIONS}
            value={status ?? 'all'}
            onChange={(v) => updateParams({ status: v === 'all' ? null : v })}
            size="sm"
          />
        </div>

        <div className="w-full min-w-0 sm:w-56">
          <Input
            label="Model"
            placeholder="Exact name, e.g. gpt-4o"
            value={modelDraft}
            list="rl-model-suggestions"
            onChange={(e) => setModelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateParams({ model: modelDraft.trim() || null })
            }}
          />
          <datalist id="rl-model-suggestions">
            {modelSuggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        <div className="min-w-0">
          <span id="rl-time-label" className="mb-1.5 block text-sm font-medium text-text-secondary">
            Time
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<TimeMode>
              aria-labelledby="rl-time-label"
              options={TIME_MODE_OPTIONS}
              value={range != null ? 'range' : 'any'}
              onChange={(v) =>
                updateParams({ range: v === 'any' ? null : serializeTimeRange(range ?? DEFAULT_RANGE) })
              }
              size="sm"
            />
            {range != null && (
              <TimeRangePicker
                value={range}
                onChange={(v) => updateParams({ range: serializeTimeRange(v) })}
                presets={ALL_TIME_RANGE_PRESETS}
                size="sm"
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          {hasFilters && (
            <Button size="sm" variant="ghost" icon={<X className="w-4 h-4" />} onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          <IconButton
            aria-label="Refresh"
            variant="secondary"
            size="md"
            icon={<RefreshCw className="w-4 h-4" />}
            loading={query.isFetching && !query.isFetchingNextPage}
            onClick={refresh}
          />
        </div>

        {keyId !== '' && (
          <div className="flex w-full flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span>
              Filtered to API key <span className="font-mono text-xs">{keyId}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => updateParams({ key_id: null })}>
              Remove
            </Button>
          </div>
        )}
      </div>

      <QueryState
        query={query}
        loading={
          <div className="rounded-xl border border-border bg-bg-secondary px-4" aria-busy="true" aria-label="Loading request logs">
            <SkeletonRows rows={8} columns={6} />
          </div>
        }
        errorTitle="Couldn't load request logs"
        empty={<div className="rounded-xl border border-border bg-bg-secondary">{emptyState}</div>}
        isEmpty={(d) => d.pages.every((p) => p.data.length === 0)}
      >
        {() => (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-border bg-bg-secondary">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-tertiary/50 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    <th scope="col" className="px-4 py-3">Time</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Model</th>
                    <th scope="col" className="px-4 py-3">Key</th>
                    <th scope="col" className="px-4 py-3 text-right">Tokens</th>
                    <th scope="col" className="px-4 py-3 text-right">Cost</th>
                    <th scope="col" className="px-4 py-3 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-bg-tertiary/30"
                      onClick={() => setSelected(row)}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          className="cursor-pointer rounded text-left text-text-primary hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          aria-label={`View details for request at ${formatDate(row.created_at)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(row)
                          }}
                        >
                          <TimeAgo date={row.created_at} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RequestStatusBadge status={row.status} />
                          {row.cache_hit && <CacheHitBadge />}
                        </div>
                      </td>
                      <td className="max-w-[18rem] px-4 py-3">
                        <div className="truncate text-text-primary">{row.model || '—'}</div>
                        {row.routed_model && row.routed_model !== row.model && (
                          <div className="truncate text-xs text-text-tertiary">→ {row.routed_model}</div>
                        )}
                        {row.error && (
                          <div className="mt-0.5 truncate text-xs text-error">
                            {row.error}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
                        {row.key_hint || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatNumber(totalTokens(row))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatCost(row.cost_usd || 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatNumber(row.latency_ms || 0)} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-tertiary">
              <span>
                Showing {formatNumber(rows.length)} request{rows.length === 1 ? '' : 's'}
              </span>
              {query.hasNextPage ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Load more
                </Button>
              ) : (
                <span>End of results</span>
              )}
            </div>
            {query.isFetchNextPageError && (
              <p role="alert" className="text-sm text-error">
                Couldn't load more requests. Try again.
              </p>
            )}
          </div>
        )}
      </QueryState>

      <RequestLogDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
