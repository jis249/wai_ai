import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { SelectOption } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { ArrowUp, CirclePause, Plus } from '../../components/ui/icons'
import { CompareColumn } from './CompareColumn'
import type { CompareColumnConfig, CompareColumnHandle, CompareColumnStatus } from './CompareColumn'
import { bestIndex, estimateCost } from './metrics'
import type { ModelPricing } from './metrics'
import type { ParametersValue } from './ParametersPanel'
import { buildResponseFormat } from './responseFormat'
import type { ChatParams } from './useChatStream'

export const MIN_COLUMNS = 2
export const MAX_COLUMNS = 4

interface CompareViewProps {
  /** Shared settings: system prompt, stream, API key, response format (and sampling when synced). */
  params: ParametersValue
  modelOptions: SelectOption[]
  modelsLoading: boolean
  /** Pricing by model name; cost is shown only for models with non-zero pricing. */
  pricing: Map<string, ModelPricing>
  synced: boolean
  onSyncedChange: (synced: boolean) => void
  /** Sending is blocked (e.g. invalid JSON schema): shown under the composer. */
  blockedReason?: string | null
  /** Called whenever the "any column streaming" state changes (to lock shared settings). */
  onBusyChange?: (busy: boolean) => void
}

let columnSeq = 0
function newColumnId(): string {
  columnSeq += 1
  return `col-${columnSeq}-${Math.random().toString(36).slice(2, 7)}`
}

function makeColumn(model: string, params: ParametersValue): CompareColumnConfig {
  return { id: newColumnId(), model, temperature: params.temperature, maxTokens: params.maxTokens, paramsOpen: false }
}

/**
 * Side-by-side comparison: 2–4 columns, one shared prompt composer. "Run all" sends the same prompt to
 * every column in parallel; each column keeps its own conversation.
 */
export function CompareView({
  params,
  modelOptions,
  modelsLoading,
  pricing,
  synced,
  onSyncedChange,
  blockedReason,
  onBusyChange,
}: CompareViewProps) {
  const [columns, setColumns] = useState<CompareColumnConfig[]>(() => [
    makeColumn(modelOptions[0]?.value ?? '', params),
    makeColumn(modelOptions[1]?.value ?? modelOptions[0]?.value ?? '', params),
  ])
  const [statuses, setStatuses] = useState<Record<string, CompareColumnStatus>>({})
  const [draft, setDraft] = useState('')
  const handles = useRef(new Map<string, CompareColumnHandle>())

  const resolveModel = useCallback(
    (col: CompareColumnConfig, i: number) =>
      col.model && modelOptions.some((o) => o.value === col.model)
        ? col.model
        : (modelOptions[i % Math.max(modelOptions.length, 1)]?.value ?? ''),
    [modelOptions],
  )

  const onStatus = useCallback((id: string, status: CompareColumnStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: status }))
  }, [])

  const liveStatuses = columns.map((c) => statuses[c.id])
  const anyStreaming = liveStatuses.some((s) => s?.isStreaming)
  const canRun = !anyStreaming && !!draft.trim() && !blockedReason && columns.some((c, i) => !!resolveModel(c, i))

  useEffect(() => {
    onBusyChange?.(anyStreaming)
  }, [anyStreaming, onBusyChange])
  // Unmounting aborts every column's stream (useChatStream cleanup): release the lock too.
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  // Badges compare only finished (not stopped) latest replies, once nothing is streaming.
  const badges: string[][] = columns.map(() => [])
  if (!anyStreaming) {
    const done = liveStatuses.map((s) => (s?.metrics && !s.metrics.stopped && !s.error ? s.metrics : null))
    const fastest = bestIndex(done.map((m) => m?.latencyMs))
    const cheapest = bestIndex(done.map((m, i) => (m ? estimateCost(m, pricing.get(resolveModel(columns[i], i))) : undefined)))
    if (fastest !== null) badges[fastest].push('Fastest')
    if (cheapest !== null) badges[cheapest].push('Cheapest')
  }

  function paramsFor(col: CompareColumnConfig, i: number): ChatParams {
    return {
      model: resolveModel(col, i),
      systemPrompt: params.systemPrompt,
      temperature: synced ? params.temperature : col.temperature,
      maxTokens: synced ? params.maxTokens : col.maxTokens,
      stream: params.stream,
      apiKey: params.apiKey,
      responseFormat: buildResponseFormat(params.responseFormat),
    }
  }

  async function runAll() {
    if (!canRun) return
    const text = draft
    setDraft('')
    await Promise.all(
      columns.map((col, i) => handles.current.get(col.id)?.send(text, paramsFor(col, i)) ?? Promise.resolve()),
    )
  }

  function stopAll() {
    handles.current.forEach((h) => h.stop())
  }

  function clearAll() {
    handles.current.forEach((h) => h.clear())
  }

  const onChange = useCallback((id: string, patch: Partial<CompareColumnConfig>) => {
    setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  function addColumn() {
    setColumns((cols) => {
      if (cols.length >= MAX_COLUMNS) return cols
      const used = new Set(cols.map((c, i) => resolveModel(c, i)))
      const next = modelOptions.find((o) => !used.has(o.value))?.value ?? modelOptions[0]?.value ?? ''
      return [...cols, makeColumn(next, params)]
    })
  }

  function removeColumn(id: string) {
    handles.current.get(id)?.stop()
    setColumns((cols) => (cols.length <= MIN_COLUMNS ? cols : cols.filter((c) => c.id !== id)))
    setStatuses((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function duplicateColumn(id: string) {
    setColumns((cols) => {
      if (cols.length >= MAX_COLUMNS) return cols
      const idx = cols.findIndex((c) => c.id === id)
      if (idx < 0) return cols
      const copy = { ...cols[idx], id: newColumnId() }
      return [...cols.slice(0, idx + 1), copy, ...cols.slice(idx + 1)]
    })
  }

  function handleSyncChange(next: boolean) {
    // Turning sync off seeds every column with the shared values so nothing jumps.
    if (!next) {
      setColumns((cols) => cols.map((c) => ({ ...c, temperature: params.temperature, maxTokens: params.maxTokens })))
    }
    onSyncedChange(next)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Toggle
            checked={synced}
            onChange={handleSyncChange}
            size="sm"
            label="Sync parameters"
            aria-label="Sync parameters"
            disabled={anyStreaming}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={addColumn}
            disabled={columns.length >= MAX_COLUMNS}
          >
            Add column
          </Button>
          <Button variant="ghost" size="sm" onClick={clearAll} disabled={anyStreaming}>
            Clear all
          </Button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col gap-3 lg:snap-x lg:flex-row lg:overflow-x-auto lg:pb-1"
        data-testid="compare-columns"
      >
        {columns.map((col, i) => (
          <CompareColumn
            key={col.id}
            ref={(h) => {
              if (h) handles.current.set(col.id, h)
              else handles.current.delete(col.id)
            }}
            index={i}
            column={col}
            resolvedModel={resolveModel(col, i)}
            modelOptions={modelOptions}
            modelsLoading={modelsLoading}
            synced={synced}
            streamEnabled={params.stream}
            pricing={pricing.get(resolveModel(col, i))}
            badges={badges[i]}
            canRemove={columns.length > MIN_COLUMNS}
            canDuplicate={columns.length < MAX_COLUMNS}
            onChange={onChange}
            onRemove={removeColumn}
            onDuplicate={duplicateColumn}
            onStatus={onStatus}
          />
        ))}
      </div>

      <div className="shrink-0 rounded-xl border border-border bg-bg-secondary p-3">
        <div className="rounded-xl border border-border bg-bg-tertiary transition-colors duration-150 focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/30">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void runAll()
              }
            }}
            placeholder="Prompt sent to every column..."
            aria-label="Compare prompt"
            rows={2}
            className="block w-full resize-none bg-transparent px-4 pb-2 pt-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-1">
            <span className="hidden text-xs text-text-tertiary sm:inline">
              Enter to run all · Shift+Enter for new line
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<CirclePause className="h-4 w-4" aria-hidden="true" />}
                onClick={stopAll}
                disabled={!anyStreaming}
              >
                Stop all
              </Button>
              <Button
                size="sm"
                icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void runAll()}
                disabled={!canRun}
              >
                Run all
              </Button>
            </div>
          </div>
        </div>
        {blockedReason && (
          <p className="px-2 pt-2 text-xs text-warning" role="status">
            {blockedReason}
          </p>
        )}
      </div>
    </div>
  )
}
