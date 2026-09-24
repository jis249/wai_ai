import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Banner } from '../../components/ui/Banner'
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
import { Toggle } from '../../components/ui/Toggle'
import { ArrowUp, KeyRound, RefreshCw, ScrollText, Search, X } from '../../components/ui/icons'
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
import { cn, formatCost, formatDate, formatNumber } from '../../lib/utils'
import { isEditableTarget } from '../../hooks/useHotkeys'
import { RequestLogDetailSheet } from './RequestLogDetailSheet'
import { CacheHitBadge, RequestStatusBadge } from './requestLogStatus'
import { LIVE_TAIL_MAX_ROWS, useLiveTail } from './useLiveTail'

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

/** Live tail auto-pauses once the page is scrolled further than this. */
export const LIVE_SCROLL_PAUSE_PX = 200

function parseStatus(raw: string | null): RequestLogStatusFilter | undefined {
  return raw === 'success' || raw === 'error' ? raw : undefined
}

function scrollToTop() {
  try {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  } catch {
    // jsdom / old browsers
  }
}

function dedupeById(rows: RequestLogRow[]): RequestLogRow[] {
  const seen = new Set<string>()
  const out: RequestLogRow[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

function LiveStatus({ reason }: { reason: string | null }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      {reason == null ? (
        <>
          <span className="relative inline-flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          Live
        </>
      ) : (
        <>
          <span className="inline-flex h-2 w-2 rounded-full bg-text-tertiary" aria-hidden="true" />
          {reason}
        </>
      )}
    </span>
  )
}

export default function RequestLogsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const status = parseStatus(searchParams.get('status'))
  const model = searchParams.get('model') ?? ''
  const keyId = searchParams.get('key_id') ?? ''
  const range = parseTimeRange(searchParams.get('range'))

  const requestId = searchParams.get('request') ?? ''

  const [modelDraft, setModelDraft] = useState(model)
  const [refreshKey, setRefreshKey] = useState(0)
  const [live, setLive] = useState(false)
  const [scrolledAway, setScrolledAway] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rowButtons = useRef(new Map<string, HTMLButtonElement>())

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

  const pagedRows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data])

  // Live tail: presets poll without the `to` bound (it was fixed when the range resolved);
  // a custom range keeps it.
  const liveFilters = useMemo(
    () => ({
      status,
      model: model || undefined,
      key_id: keyId || undefined,
      from: bounds?.from,
      to: range != null && isCustomTimeRange(range) ? bounds?.to : undefined,
    }),
    [status, model, keyId, bounds, range],
  )
  const liveKey = `${status ?? ''}|${model}|${keyId}|${rangeKey}|${refreshKey}`

  const tail = useLiveTail({
    enabled: live,
    paused: scrolledAway || (requestId !== '' && pagedRows.some((r) => r.id === requestId)),
    openRowId: requestId || undefined,
    filters: liveFilters,
    resetKey: liveKey,
    newestLoaded: pagedRows[0],
  })

  const allRows = useMemo(() => dedupeById([...tail.rows, ...pagedRows]), [tail.rows, pagedRows])
  const truncated = allRows.length > LIVE_TAIL_MAX_ROWS
  const rows = truncated ? allRows.slice(0, LIVE_TAIL_MAX_ROWS) : allRows
  const selectedRow = requestId ? (rows.find((r) => r.id === requestId) ?? null) : null
  const deepLinkMissing = requestId !== '' && selectedRow == null && query.isSuccess && !query.isFetching

  const requestIdRef = useRef(requestId)
  const flushRef = useRef(tail.flush)
  useEffect(() => {
    requestIdRef.current = requestId
    flushRef.current = tail.flush
  })

  // Auto-pause the live tail while the user is reading further down the page.
  useEffect(() => {
    if (!live) return
    const onScroll = () => {
      const away = window.scrollY > LIVE_SCROLL_PAUSE_PX
      setScrolledAway(away)
      if (!away && requestIdRef.current === '') flushRef.current()
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [live])

  const pauseReason = !live
    ? null
    : tail.hidden
      ? 'Paused (tab hidden)'
      : selectedRow != null
        ? 'Paused while viewing details'
        : scrolledAway
          ? 'Paused (scrolled down)'
          : null

  function openRow(row: RequestLogRow) {
    updateParams({ request: row.id })
  }

  function jumpToTop() {
    scrollToTop()
    setScrolledAway(false)
    tail.flush()
  }

  function focusRow(index: number) {
    const clamped = Math.min(Math.max(index, 0), rows.length - 1)
    const row = rows[clamped]
    if (row == null) return
    setActiveIndex(clamped)
    rowButtons.current.get(row.id)?.focus()
  }

  // j / k move between rows, Enter opens the focused row. Only while focus is inside the
  // table; preventDefault keeps global single-key shortcuts from also firing.
  function onTableKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || isEditableTarget(e.target)) return
    const current = Math.min(activeIndex, rows.length - 1)
    if (e.key === 'j') {
      e.preventDefault()
      focusRow(current + 1)
    } else if (e.key === 'k') {
      e.preventDefault()
      focusRow(current - 1)
    } else if (e.key === 'Enter') {
      const target = e.target as HTMLElement
      if (target.closest('button, a')) return // native activation
      const row = rows[current]
      if (row != null) {
        e.preventDefault()
        openRow(row)
      }
    }
  }

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

        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <div className="flex items-center gap-2">
            <Toggle checked={live} onChange={setLive} label="Live tail" aria-label="Live tail" size="sm" />
            {live && <LiveStatus reason={pauseReason} />}
          </div>
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

      {deepLinkMissing && (
        <Banner
          variant="info"
          title={`Request ${requestId} not in the loaded range`}
          description="Widen the time range, clear filters or load more rows to find it."
          onDismiss={() => updateParams({ request: null })}
        />
      )}

      {live && tail.error != null && (
        <p role="alert" className="text-sm text-error">
          Live tail couldn't fetch new requests. Retrying every few seconds.
        </p>
      )}

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
            {tail.pending.length > 0 && (
              <div className="sticky top-16 z-10 flex justify-center lg:top-4">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<ArrowUp className="w-4 h-4" />}
                  onClick={jumpToTop}
                  className="rounded-full shadow-lg"
                >
                  {formatNumber(tail.pending.length)} new — jump to top
                </Button>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-border bg-bg-secondary">
              <table className="min-w-full text-sm" onKeyDown={onTableKeyDown} aria-describedby="rl-keyboard-hint">
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
                  {rows.map((row, index) => (
                    <tr
                      key={row.id}
                      data-highlighted={tail.highlighted.has(row.id) ? 'true' : undefined}
                      className={cn(
                        'cursor-pointer border-b border-border last:border-0 motion-safe:transition-colors motion-safe:duration-700 hover:bg-bg-tertiary/30 focus-within:bg-bg-tertiary/40',
                        tail.highlighted.has(row.id) && 'bg-accent/10',
                      )}
                      onClick={() => openRow(row)}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) rowButtons.current.set(row.id, el)
                            else rowButtons.current.delete(row.id)
                          }}
                          className="cursor-pointer rounded text-left text-text-primary hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          aria-label={`View details for request at ${formatDate(row.created_at)}`}
                          onFocus={() => setActiveIndex(index)}
                          onClick={(e) => {
                            e.stopPropagation()
                            openRow(row)
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
                Showing {truncated ? 'the newest ' : ''}
                {formatNumber(rows.length)} request{rows.length === 1 ? '' : 's'}
                <span id="rl-keyboard-hint" className="ml-2 hidden text-xs sm:inline">
                  <kbd className="rounded border border-border px-1 font-mono">j</kbd> /{' '}
                  <kbd className="rounded border border-border px-1 font-mono">k</kbd> move between rows,{' '}
                  <kbd className="rounded border border-border px-1 font-mono">Enter</kbd> opens details
                </span>
              </span>
              {truncated ? (
                <span>Live tail keeps the newest {formatNumber(LIVE_TAIL_MAX_ROWS)} rows</span>
              ) : query.hasNextPage ? (
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

      <RequestLogDetailSheet
        row={selectedRow}
        onClose={() => {
          updateParams({ request: null })
          if (!scrolledAway) tail.flush()
        }}
      />
    </div>
  )
}
