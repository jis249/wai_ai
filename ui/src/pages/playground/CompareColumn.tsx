import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react'
import { Badge } from '../../components/ui/Badge'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import type { SelectOption } from '../../components/ui/Select'
import { Skeleton } from '../../components/ui/Skeleton'
import { CirclePause, Copy, SlidersHorizontal, X } from '../../components/ui/icons'
import { cn } from '../../lib/utils'
import { AssistantContent } from './ChatPanel'
import { TypingIndicator } from './MessageMarkdown'
import { estimateCost, formatCost, formatMetrics } from './metrics'
import type { ModelPricing } from './metrics'
import { useChatStream } from './useChatStream'
import type { ChatParams, MessageMetrics } from './useChatStream'

export interface CompareColumnConfig {
  id: string
  model: string
  temperature: number
  maxTokens: number
  paramsOpen: boolean
}

export interface CompareColumnStatus {
  isStreaming: boolean
  /** Metrics of the latest assistant reply. */
  metrics: MessageMetrics | null
  error: string | null
}

export interface CompareColumnHandle {
  send: (text: string, params: ChatParams) => Promise<void>
  stop: () => void
  clear: () => void
}

interface CompareColumnProps {
  index: number
  column: CompareColumnConfig
  /** Model actually used (the column's pick, or a fallback when it is unavailable). */
  resolvedModel: string
  modelOptions: SelectOption[]
  modelsLoading: boolean
  /** "Sync parameters" on: per-column temperature/max tokens are hidden. */
  synced: boolean
  streamEnabled: boolean
  pricing?: ModelPricing
  /** Text badges for the latest reply, e.g. "Fastest", "Cheapest". */
  badges: string[]
  canRemove: boolean
  canDuplicate: boolean
  onChange: (id: string, patch: Partial<CompareColumnConfig>) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
  onStatus: (id: string, status: CompareColumnStatus) => void
}

/** One side-by-side column: its own model, params and useChatStream instance. */
export const CompareColumn = forwardRef<CompareColumnHandle, CompareColumnProps>(function CompareColumn(
  {
    index,
    column,
    resolvedModel,
    modelOptions,
    modelsLoading,
    synced,
    streamEnabled,
    pricing,
    badges,
    canRemove,
    canDuplicate,
    onChange,
    onRemove,
    onDuplicate,
    onStatus,
  },
  ref,
) {
  const chat = useChatStream()
  const { send, stop, clear, isStreaming, error, metrics, messages } = chat
  const label = `Column ${index + 1}`
  const ids = { params: useId(), temp: useId(), maxTokens: useId() }
  const endRef = useRef<HTMLDivElement>(null)
  const lastId = messages[messages.length - 1]?.id
  const lastIsAssistant = messages[messages.length - 1]?.role === 'assistant'

  useImperativeHandle(ref, () => ({ send, stop, clear }), [send, stop, clear])

  useEffect(() => {
    onStatus(column.id, { isStreaming, metrics, error })
  }, [column.id, isStreaming, metrics, error, onStatus])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [messages, isStreaming])

  return (
    <section
      aria-label={`${label}: ${resolvedModel || 'no model'}`}
      data-testid="compare-column"
      className="flex max-h-[32rem] min-h-[18rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary lg:max-h-none lg:min-h-0 lg:w-[20rem] lg:min-w-[18rem] lg:flex-1 lg:shrink-0 lg:snap-start"
    >
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-3">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">{label}</span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-text-tertiary">
            <span
              className={isStreaming ? 'h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent' : 'h-2 w-2 shrink-0 rounded-full bg-success'}
              aria-hidden="true"
            />
            <span className="truncate">{isStreaming ? 'Generating…' : 'Ready'}</span>
          </span>
          {isStreaming && (
            <IconButton size="sm" icon={<CirclePause />} aria-label={`Stop ${label}`} onClick={stop} />
          )}
          {!synced && (
            <IconButton
              size="sm"
              icon={<SlidersHorizontal />}
              aria-label={`${column.paramsOpen ? 'Hide' : 'Show'} ${label} parameters`}
              aria-expanded={column.paramsOpen}
              aria-controls={ids.params}
              onClick={() => onChange(column.id, { paramsOpen: !column.paramsOpen })}
            />
          )}
          <IconButton
            size="sm"
            icon={<Copy />}
            aria-label={`Duplicate ${label}`}
            onClick={() => onDuplicate(column.id)}
            disabled={!canDuplicate}
          />
          <IconButton
            size="sm"
            variant="destructive"
            icon={<X />}
            aria-label={`Remove ${label}`}
            onClick={() => onRemove(column.id)}
            disabled={!canRemove || isStreaming}
          />
        </div>
        {modelsLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div role="group" aria-label={`${label} model`} className="relative z-20">
            <Select
              options={modelOptions}
              value={resolvedModel}
              onChange={(model) => onChange(column.id, { model })}
              placeholder={modelOptions.length === 0 ? 'No models available' : 'Select a model...'}
              searchable={modelOptions.length > 8}
              disabled={modelOptions.length === 0 || isStreaming}
              fullWidth
            />
          </div>
        )}
        {!synced && column.paramsOpen && (
          <div id={ids.params} className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor={ids.temp} className="text-[10px] font-medium uppercase tracking-widest text-text-tertiary">
                  Temperature
                </label>
                <span className="font-mono text-xs text-accent">{column.temperature.toFixed(1)}</span>
              </div>
              <input
                id={ids.temp}
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={column.temperature}
                onChange={(e) => onChange(column.id, { temperature: parseFloat(e.target.value) })}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent"
                disabled={isStreaming}
              />
            </div>
            <div>
              <label htmlFor={ids.maxTokens} className="mb-1 block text-[10px] font-medium uppercase tracking-widest text-text-tertiary">
                Max tokens
              </label>
              <Input
                id={ids.maxTokens}
                type="number"
                min={1}
                max={128000}
                value={column.maxTokens}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!Number.isNaN(v) && v > 0) onChange(column.id, { maxTokens: v })
                }}
                disabled={isStreaming}
                className="py-1 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4" aria-live="polite">
        {messages.length === 0 && !isStreaming && (
          <p className="py-10 text-center text-sm text-text-tertiary">Replies from {resolvedModel || 'this model'} appear here</p>
        )}
        {messages.map((msg) => {
          const cost = msg.role === 'assistant' ? estimateCost(msg.metrics, pricing) : undefined
          const isLatest = msg.id === lastId
          return (
            <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('flex min-w-0 flex-col gap-1', msg.role === 'user' ? 'max-w-[85%]' : 'w-full')}>
                <div
                  className={cn(
                    'min-w-0 px-3 py-2.5 text-sm leading-relaxed text-text-primary',
                    msg.role === 'user'
                      ? 'rounded-2xl rounded-tr-sm border border-accent/20 bg-accent/10'
                      : 'rounded-2xl rounded-tl-sm border border-border bg-bg-primary',
                  )}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  ) : msg.content ? (
                    <AssistantContent content={msg.content} streaming={isStreaming && isLatest} />
                  ) : isStreaming && isLatest ? (
                    <TypingIndicator />
                  ) : (
                    <p className="italic text-text-tertiary">No content</p>
                  )}
                </div>
                {msg.role === 'assistant' && msg.metrics && (
                  <div className="flex flex-wrap items-center gap-1.5 px-1">
                    <p className="font-mono text-[11px] text-text-tertiary" data-testid="compare-metrics">
                      {formatMetrics(msg.metrics)}
                      {cost !== undefined && ` · ~${formatCost(cost)}`}
                    </p>
                    {isLatest &&
                      badges.map((b) => (
                        <Badge key={b} variant="success" className="px-1.5 py-0 text-[10px]">
                          {b}
                        </Badge>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {isStreaming && !streamEnabled && !lastIsAssistant && (
          <div className="rounded-2xl rounded-tl-sm border border-border bg-bg-primary px-3 py-2.5">
            <TypingIndicator />
          </div>
        )}
        {error !== null && (
          <div role="alert" className="break-words rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  )
})
