/**
 * Playground presets and last-used chat settings in localStorage (per browser).
 *
 * API keys are never stored: presets hold the model, system prompt, sampling params and
 * response format only. Every storage access is guarded (private mode / blocked storage).
 */
import type { ParametersValue } from './ParametersPanel'
import { DEFAULT_RESPONSE_FORMAT } from './responseFormat'
import type { ResponseFormatType, ResponseFormatValue } from './responseFormat'

export const PRESETS_STORAGE_KEY = 'wai.playground.presets'
export const LAST_SETTINGS_STORAGE_KEY = 'wai.playground.last'

/** Everything a preset restores (no API key). */
export interface PresetSettings {
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  stream: boolean
  responseFormat: ResponseFormatValue
}

export interface PlaygroundPreset extends PresetSettings {
  id: string
  name: string
  updatedAt: string
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const FORMAT_TYPES: ResponseFormatType[] = ['text', 'json_object', 'json_schema']

function sanitizeFormat(raw: unknown): ResponseFormatValue {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RESPONSE_FORMAT }
  const r = raw as Partial<ResponseFormatValue>
  return {
    type: FORMAT_TYPES.includes(r.type as ResponseFormatType) ? (r.type as ResponseFormatType) : 'text',
    schemaName: typeof r.schemaName === 'string' ? r.schemaName : DEFAULT_RESPONSE_FORMAT.schemaName,
    schema: typeof r.schema === 'string' ? r.schema : DEFAULT_RESPONSE_FORMAT.schema,
    strict: typeof r.strict === 'boolean' ? r.strict : DEFAULT_RESPONSE_FORMAT.strict,
  }
}

/** Validate a stored settings object; null if unusable. */
export function sanitizeSettings(raw: unknown): PresetSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const temperature = typeof r.temperature === 'number' && r.temperature >= 0 && r.temperature <= 2 ? r.temperature : null
  const maxTokens = typeof r.maxTokens === 'number' && Number.isInteger(r.maxTokens) && r.maxTokens > 0 ? r.maxTokens : null
  if (temperature === null || maxTokens === null) return null
  return {
    model: typeof r.model === 'string' ? r.model : '',
    systemPrompt: typeof r.systemPrompt === 'string' ? r.systemPrompt : '',
    temperature,
    maxTokens,
    stream: typeof r.stream === 'boolean' ? r.stream : true,
    responseFormat: sanitizeFormat(r.responseFormat),
  }
}

export function settingsFrom(model: string, params: ParametersValue): PresetSettings {
  return {
    model,
    systemPrompt: params.systemPrompt,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    stream: params.stream,
    responseFormat: params.responseFormat ?? { ...DEFAULT_RESPONSE_FORMAT },
  }
}

export function loadPresets(): PlaygroundPreset[] {
  const raw = readJson(PRESETS_STORAGE_KEY)
  if (!Array.isArray(raw)) return []
  const out: PlaygroundPreset[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const settings = sanitizeSettings(r)
    if (!settings || typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) continue
    out.push({ ...settings, id: r.id, name: r.name, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '' })
  }
  return out
}

function newPresetId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Save (or overwrite, matched by case-insensitive name). Returns the new list, or null if storage failed. */
export function savePreset(name: string, settings: PresetSettings): PlaygroundPreset[] | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const list = loadPresets()
  const existing = list.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  const preset: PlaygroundPreset = {
    ...settings,
    id: existing?.id ?? newPresetId(),
    name: trimmed,
    updatedAt: new Date().toISOString(),
  }
  const next = existing ? list.map((p) => (p.id === existing.id ? preset : p)) : [...list, preset]
  next.sort((a, b) => a.name.localeCompare(b.name))
  return writeJson(PRESETS_STORAGE_KEY, next) ? next : null
}

export function deletePreset(id: string): PlaygroundPreset[] | null {
  const next = loadPresets().filter((p) => p.id !== id)
  return writeJson(PRESETS_STORAGE_KEY, next) ? next : null
}

export function loadLastSettings(): PresetSettings | null {
  return sanitizeSettings(readJson(LAST_SETTINGS_STORAGE_KEY))
}

export function saveLastSettings(settings: PresetSettings): void {
  writeJson(LAST_SETTINGS_STORAGE_KEY, settings)
}
