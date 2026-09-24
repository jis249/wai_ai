import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  deletePreset,
  LAST_SETTINGS_STORAGE_KEY,
  loadLastSettings,
  loadPresets,
  PRESETS_STORAGE_KEY,
  saveLastSettings,
  savePreset,
  settingsFrom,
} from './presets'
import type { PresetSettings } from './presets'

const settings: PresetSettings = {
  model: 'gpt-x',
  systemPrompt: 'Extract fields.',
  temperature: 0.2,
  maxTokens: 512,
  stream: false,
  responseFormat: { type: 'json_schema', schemaName: 'person', schema: '{"type":"object"}', strict: true },
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('presets', () => {
  it('round-trips save, load and delete', () => {
    expect(loadPresets()).toEqual([])
    const saved = savePreset('  Extractor ', settings)
    expect(saved).toHaveLength(1)
    const loaded = loadPresets()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ ...settings, name: 'Extractor' })

    savePreset('Another', { ...settings, model: 'm2' })
    expect(loadPresets().map((p) => p.name)).toEqual(['Another', 'Extractor'])

    expect(deletePreset(loaded[0].id)?.map((p) => p.name)).toEqual(['Another'])
    expect(loadPresets().map((p) => p.name)).toEqual(['Another'])
  })

  it('overwrites a preset with the same name (case-insensitive)', () => {
    const [first] = savePreset('Extractor', settings)!
    savePreset('extractor', { ...settings, temperature: 1.5 })
    const list = loadPresets()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: first.id, name: 'extractor', temperature: 1.5 })
  })

  it('never stores an API key', () => {
    const s = settingsFrom('m', { systemPrompt: 's', temperature: 1, maxTokens: 10, stream: true, apiKey: 'wa_uk_topsecret' })
    savePreset('p', s)
    saveLastSettings(s)
    expect(localStorage.getItem(PRESETS_STORAGE_KEY)).not.toContain('topsecret')
    expect(localStorage.getItem(LAST_SETTINGS_STORAGE_KEY)).not.toContain('topsecret')
    expect(s.responseFormat.type).toBe('text')
  })

  it('ignores corrupt or invalid stored data', () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, '{not json')
    expect(loadPresets()).toEqual([])
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify([{ id: 'x', name: 'bad', temperature: 9, maxTokens: 1 }, 5]))
    expect(loadPresets()).toEqual([])
    localStorage.setItem(LAST_SETTINGS_STORAGE_KEY, JSON.stringify({ temperature: 'hot' }))
    expect(loadLastSettings()).toBeNull()
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadPresets()).toEqual([])
    expect(savePreset('x', settings)).toBeNull()
    expect(loadLastSettings()).toBeNull()
    expect(() => saveLastSettings(settings)).not.toThrow()
  })

  it('persists the last-used settings', () => {
    saveLastSettings(settings)
    expect(loadLastSettings()).toEqual(settings)
  })
})
