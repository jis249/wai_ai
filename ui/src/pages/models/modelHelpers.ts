import type { SelectOption } from '../../components/ui/Select'
import type { SortState } from '../../components/ui/Table'
import type { ModelResponse } from '../../hooks/useModels'
import { isKnownProvider } from '../../lib/providers'
import type { ProviderKey } from '../../lib/providers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const providerLabels: Record<ProviderKey, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure',
  vllm: 'vLLM',
  ollama: 'Ollama',
  custom: 'Custom',
}

export const PROVIDER_OPTIONS: SelectOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'azure', label: 'Azure' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom' },
]

export const MODEL_TYPE_OPTIONS: SelectOption[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'reranking', label: 'Reranking' },
  { value: 'completion', label: 'Completion' },
  { value: 'image', label: 'Image Generation' },
  { value: 'audio_transcription', label: 'Audio Transcription' },
  { value: 'tts', label: 'Text to Speech' },
]

export const STRATEGY_OPTIONS: SelectOption[] = [
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'least-busy', label: 'Least Busy' },
  { value: 'weighted', label: 'Weighted' },
  { value: 'priority', label: 'Priority' },
]

export const typeLabels: Record<string, string> = {
  chat: 'Chat',
  embedding: 'Embedding',
  reranking: 'Reranking',
  completion: 'Completion',
  image: 'Image',
  audio_transcription: 'Audio',
  tts: 'TTS',
}

export const typeBadgeVariant: Record<string, 'default' | 'info' | 'muted' | 'success' | 'warning'> = {
  chat: 'default',
  embedding: 'info',
  reranking: 'info',
  completion: 'muted',
  image: 'success',
  audio_transcription: 'warning',
  tts: 'warning',
}

export const BASE_URL_PLACEHOLDERS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  azure: 'https://<resource>.openai.azure.com',
  vllm: 'http://localhost:8000/v1',
  ollama: 'http://localhost:11434/v1',
  custom: 'https://your-endpoint/v1',
}

export function baseUrlPlaceholder(provider: string): string {
  return BASE_URL_PLACEHOLDERS[provider] ?? 'https://'
}

/** Display label for any provider string (unknown providers pass through). */
export function providerLabel(provider: string): string {
  return isKnownProvider(provider) ? providerLabels[provider] : provider
}

// ---------------------------------------------------------------------------
// Form values shared by the create / edit sheets
// ---------------------------------------------------------------------------

export interface ModelFormValues {
  name: string
  type: string
  provider: string
  baseUrl: string
  apiKey: string
  aliases: string[]
  maxContextTokens: string
  inputPrice: string
  outputPrice: string
  azureDeployment: string
  azureApiVersion: string
  timeout: string
  strategy: string
  maxRetries: string
  fallbackModelName: string
}

export type ModelFormPatch = Partial<ModelFormValues>

export function emptyModelForm(): ModelFormValues {
  return {
    name: '',
    type: 'chat',
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    aliases: [],
    maxContextTokens: '',
    inputPrice: '',
    outputPrice: '',
    azureDeployment: '',
    azureApiVersion: '',
    timeout: '',
    strategy: 'round-robin',
    maxRetries: '',
    fallbackModelName: '',
  }
}

export function modelToForm(model: ModelResponse): ModelFormValues {
  return {
    ...emptyModelForm(),
    name: model.name,
    type: model.type || 'chat',
    provider: model.provider,
    baseUrl: model.base_url,
    aliases: [...(model.aliases ?? [])],
    maxContextTokens: model.max_context_tokens > 0 ? String(model.max_context_tokens) : '',
    inputPrice: model.input_price_per_1m > 0 ? String(model.input_price_per_1m) : '',
    outputPrice: model.output_price_per_1m > 0 ? String(model.output_price_per_1m) : '',
    azureDeployment: model.azure_deployment ?? '',
    azureApiVersion: model.azure_api_version ?? '',
    timeout: model.timeout ?? '',
    fallbackModelName: model.fallback_model_name ?? '',
  }
}

/** Parses a trimmed integer field; undefined when empty or not a number. */
export function parseOptionalInt(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? undefined : parsed
}

/** Parses a trimmed float field; undefined when empty or not a number. */
export function parseOptionalFloat(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = parseFloat(value)
  return isNaN(parsed) ? undefined : parsed
}

/** Trimmed, non-empty, de-duplicated alias list (what the API expects). */
export function normalizeAliases(aliases: string[]): string[] {
  const out: string[] = []
  for (const a of aliases) {
    const t = a.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Splits free text ("a, b,c") into alias tokens. */
export function splitAliasText(text: string): string[] {
  return text.split(',').map((a) => a.trim()).filter(Boolean)
}

/** Fallback options: "None" plus other models of the same type. */
export function buildFallbackOptions(models: ModelResponse[], name: string, type: string): SelectOption[] {
  return [
    { value: '', label: 'None' },
    ...models
      .filter((m) => m.name !== name && m.type === type)
      .map((m) => ({ value: m.name, label: m.name })),
  ]
}

// ---------------------------------------------------------------------------
// Deployment form entry
// ---------------------------------------------------------------------------

export interface DeploymentEntry {
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  azureDeployment: string
  azureApiVersion: string
  /** Kept as text while editing; parsed on save. */
  weight: string
  priority: string
}

export interface DeploymentEntryErrors {
  name?: string
  provider?: string
  base_url?: string
}

export function emptyDeploymentEntry(): DeploymentEntry {
  return {
    name: '',
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    azureDeployment: '',
    azureApiVersion: '',
    weight: '1',
    priority: '0',
  }
}

// ---------------------------------------------------------------------------
// Search + sort (client-side)
// ---------------------------------------------------------------------------

export function modelMatchesSearch(model: ModelResponse, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    model.name,
    model.provider,
    providerLabel(model.provider),
    ...(model.aliases ?? []),
    ...(model.deployments ?? []).flatMap((d) => [d.name, d.provider, providerLabel(d.provider)]),
  ]
  return haystack.some((s) => s != null && s.toLowerCase().includes(q))
}

export type ModelSortColumn = 'name' | 'provider' | 'is_active'

export const SORTABLE_COLUMNS: readonly string[] = ['name', 'provider', 'is_active']

function sortKey(model: ModelResponse, column: string): string {
  switch (column) {
    case 'provider':
      return providerLabel(model.provider).toLowerCase()
    case 'is_active':
      // Active first when ascending.
      return model.is_active ? '0' : '1'
    default:
      return model.name.toLowerCase()
  }
}

export function sortModels(models: ModelResponse[], sort: SortState | undefined): ModelResponse[] {
  if (!sort || !SORTABLE_COLUMNS.includes(sort.column)) return models
  const dir = sort.direction === 'asc' ? 1 : -1
  return [...models].sort((a, b) => {
    const cmp = sortKey(a, sort.column).localeCompare(sortKey(b, sort.column))
    if (cmp !== 0) return cmp * dir
    // Stable, readable tie-break by name.
    return a.name.localeCompare(b.name)
  })
}

/** Click on a sortable header: new column → asc, same column → toggle direction. */
export function nextSort(current: SortState | undefined, column: string): SortState {
  if (current?.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { column, direction: 'asc' }
}
