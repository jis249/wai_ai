import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Sheet } from '../components/ui/Sheet'
import type { SelectOption } from '../components/ui/Select'
import { Settings, SlidersHorizontal, Terminal } from '../components/ui/icons'
import { useAvailableModels } from '../hooks/useAvailableModels'
import { useAccessibleModels } from '../hooks/useModels'
import { ChatPanel } from './playground/ChatPanel'
import { CodeDialog } from './playground/CodeDialog'
import { EmbeddingsPanel } from './playground/EmbeddingsPanel'
import { SimilarityPanel } from './playground/SimilarityPanel'
import { ParametersPanel } from './playground/ParametersPanel'
import type { ParametersValue, PlaygroundMode } from './playground/ParametersPanel'
import { useChatStream } from './playground/useChatStream'
import { CompareView } from './playground/CompareView'
import { PresetsMenu } from './playground/PresetsMenu'
import { loadLastSettings, saveLastSettings, settingsFrom } from './playground/presets'
import type { PlaygroundPreset } from './playground/presets'
import { buildResponseFormat, DEFAULT_RESPONSE_FORMAT, validateSchemaForm } from './playground/responseFormat'
import type { ModelPricing } from './playground/metrics'

const DEFAULT_PARAMS: ParametersValue = {
  systemPrompt: 'You are a helpful assistant.',
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  apiKey: '',
  responseFormat: DEFAULT_RESPONSE_FORMAT,
}

type PlaygroundView = 'chat' | 'compare' | 'embedding'

const VIEW_OPTIONS: { value: PlaygroundView; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'compare', label: 'Compare' },
  { value: 'embedding', label: 'Embedding' },
]

/** Last-used chat settings (never the API key). */
function initialSettings(): { model: string; params: ParametersValue } {
  const last = loadLastSettings()
  if (!last) return { model: '', params: DEFAULT_PARAMS }
  const { model, ...rest } = last
  return { model, params: { ...DEFAULT_PARAMS, ...rest } }
}

function matchesMode(modelType: string, mode: PlaygroundMode): boolean {
  if (mode === 'chat') return modelType === 'chat' || modelType === 'completion'
  return modelType === 'embedding'
}

export default function PlaygroundPage() {
  const [initial] = useState(initialSettings)
  const [view, setView] = useState<PlaygroundView>('chat')
  const [model, setModel] = useState(initial.model)
  const [params, setParams] = useState<ParametersValue>(initial.params)
  const [synced, setSynced] = useState(true)
  const [compareBusy, setCompareBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  // Bumping remounts the embedding panels (Clear).
  const [embedResetKey, setEmbedResetKey] = useState(0)

  const modelsQuery = useAvailableModels({ alwaysFresh: true })
  // Pricing only (for compare-mode cost estimates); failures just hide the cost.
  const pricingQuery = useAccessibleModels()
  const chat = useChatStream()
  const mode: PlaygroundMode = view === 'embedding' ? 'embedding' : 'chat'

  const pricing = useMemo(() => {
    const map = new Map<string, ModelPricing>()
    for (const m of pricingQuery.data?.data ?? []) {
      const entry = { inputPer1m: m.input_price_per_1m ?? 0, outputPer1m: m.output_price_per_1m ?? 0 }
      map.set(m.name, entry)
      for (const alias of m.aliases ?? []) if (!map.has(alias)) map.set(alias, entry)
    }
    return map
  }, [pricingQuery.data])

  useEffect(() => {
    saveLastSettings(settingsFrom(model, params))
  }, [model, params])

  const tabModels = useMemo(
    () => (modelsQuery.data?.models ?? []).filter((m) => matchesMode(m.type, mode)),
    [modelsQuery.data, mode],
  )
  const resolvedModel = model && tabModels.some((m) => m.name === model) ? model : (tabModels[0]?.name ?? '')
  const modelOptions: SelectOption[] = tabModels.map((m) => ({ value: m.name, label: m.name }))
  const isChat = view === 'chat'
  const isCompare = view === 'compare'
  const schemaCheck = validateSchemaForm(params.responseFormat ?? DEFAULT_RESPONSE_FORMAT)
  const blockedReason = schemaCheck.ok ? null : 'Fix the JSON schema under Response format to send.'
  const busy = chat.isStreaming || compareBusy

  function handleViewChange(next: PlaygroundView) {
    setView(next)
    chat.setError(null)
  }

  function handleLoadPreset(preset: PlaygroundPreset) {
    if (preset.model) setModel(preset.model)
    setParams((p) => ({
      ...p,
      systemPrompt: preset.systemPrompt,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
      stream: preset.stream,
      responseFormat: preset.responseFormat,
    }))
  }

  const handleCompareBusy = useCallback((b: boolean) => setCompareBusy(b), [])

  function handleClear() {
    if (isChat) chat.clear()
    else setEmbedResetKey((k) => k + 1)
  }

  const parametersPanel = (
    <ParametersPanel
      mode={mode}
      modelOptions={modelOptions}
      model={resolvedModel}
      onModelChange={setModel}
      modelsLoading={modelsQuery.isPending && !modelsQuery.isError}
      modelsError={modelsQuery.isError && !modelsQuery.data ? modelsQuery.error : null}
      onRetryModels={() => void modelsQuery.refetch()}
      value={params}
      onChange={(patch) => setParams((p) => ({ ...p, ...patch }))}
      disabled={busy}
      showModel={!isCompare}
      showSampling={!isCompare || synced}
    />
  )

  return (
    <div className="flex min-w-0 flex-col lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="mb-4 shrink-0">
        <PageHeader title="Playground" description="Test models interactively" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl aria-label="Playground mode" options={VIEW_OPTIONS} value={view} onChange={handleViewChange} />
          <div className="flex flex-wrap items-center gap-2">
            {view !== 'embedding' && (
              <PresetsMenu current={settingsFrom(resolvedModel, params)} onLoad={handleLoadPreset} disabled={busy} />
            )}
            {isChat && (
              <Button variant="secondary" size="sm" icon={<Terminal className="h-4 w-4" aria-hidden="true" />} onClick={() => setCodeOpen(true)}>
                View code
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="lg:hidden"
              icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* Parameters — desktop sidebar; on mobile it opens in a Sheet */}
        <aside className="hidden min-h-0 shrink-0 flex-col rounded-xl border border-border bg-bg-secondary lg:flex lg:w-80">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-4">
            <Settings className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
            <h2 className="text-sm font-medium text-text-primary">Configuration</h2>
            {isCompare && <span className="ml-auto text-xs text-text-tertiary">Shared by all columns</span>}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{parametersPanel}</div>
        </aside>

        {isCompare ? (
          <CompareView
            params={params}
            modelOptions={modelOptions}
            modelsLoading={modelsQuery.isPending && !modelsQuery.isError}
            pricing={pricing}
            synced={synced}
            onSyncedChange={setSynced}
            blockedReason={blockedReason}
            onBusyChange={handleCompareBusy}
          />
        ) : (
          <section
            aria-label={isChat ? 'Chat' : 'Embeddings'}
            className="flex h-[calc(100dvh-12rem)] min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary lg:h-auto lg:min-h-0"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                {resolvedModel ? (
                  <span className="truncate rounded-full border border-accent/20 bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
                    {resolvedModel}
                  </span>
                ) : (
                  <span className="rounded-full border border-border bg-bg-tertiary px-2.5 py-1 text-xs text-text-tertiary">
                    No model selected
                  </span>
                )}
                {isChat && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-tertiary">
                    <span className={chat.isStreaming ? 'h-2 w-2 animate-pulse rounded-full bg-accent' : 'h-2 w-2 rounded-full bg-success'} aria-hidden="true" />
                    {chat.isStreaming ? 'Generating…' : 'Ready'}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={handleClear} disabled={isChat && chat.messages.length === 0}>
                Clear
              </Button>
            </div>

            {isChat ? (
              <ChatPanel
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                streamEnabled={params.stream}
                error={chat.error}
                usage={chat.usage}
                canSend={!!resolvedModel && !blockedReason}
                blockedReason={blockedReason}
                onSend={(text) =>
                  void chat.send(text, { ...params, model: resolvedModel, responseFormat: buildResponseFormat(params.responseFormat) })
                }
                onStop={chat.stop}
              />
            ) : (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-5 sm:px-5">
                <EmbeddingsPanel key={`embed-${embedResetKey}`} model={resolvedModel} apiKey={params.apiKey} />
                <SimilarityPanel key={`sim-${embedResetKey}`} model={resolvedModel} apiKey={params.apiKey} />
              </div>
            )}
          </section>
        )}
      </div>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" width="sm">
        {parametersPanel}
      </Sheet>

      {codeOpen && (
        <CodeDialog open onClose={() => setCodeOpen(false)} model={resolvedModel} params={params} messages={chat.messages} />
      )}
    </div>
  )
}
