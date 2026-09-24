import { describe, it, expect } from 'vitest'
import {
  buildResponseFormat,
  DEFAULT_RESPONSE_FORMAT,
  lineColumnAt,
  prettyJsonReply,
  validateJson,
  validateSchemaForm,
} from './responseFormat'
import { bestIndex, estimateCost, formatCost } from './metrics'

describe('validateJson', () => {
  it('accepts valid JSON', () => {
    expect(validateJson('{"a": 1}')).toMatchObject({ ok: true, value: { a: 1 } })
  })

  it('reports the line of a syntax error', () => {
    const text = '{\n  "type": "object",\n  "properties": {,}\n}'
    const r = validateJson(text)
    expect(r.ok).toBe(false)
    expect(r.line).toBe(3)
    expect(r.error).toBeTruthy()
  })

  it('points at the last line for truncated input', () => {
    const r = validateJson('{\n  "a": 1,\n  "b": ')
    expect(r.ok).toBe(false)
    expect(r.line).toBe(3)
  })

  it('rejects empty text', () => {
    expect(validateJson('  ')).toMatchObject({ ok: false, error: 'Enter a JSON schema' })
  })

  it('lineColumnAt maps offsets to 1-based positions', () => {
    expect(lineColumnAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
    expect(lineColumnAt('ab', 0)).toEqual({ line: 1, column: 1 })
  })
})

describe('validateSchemaForm / buildResponseFormat', () => {
  it('plain text sends no response_format', () => {
    expect(buildResponseFormat(DEFAULT_RESPONSE_FORMAT)).toBeUndefined()
    expect(buildResponseFormat(undefined)).toBeUndefined()
  })

  it('json_object', () => {
    expect(buildResponseFormat({ ...DEFAULT_RESPONSE_FORMAT, type: 'json_object' })).toEqual({ type: 'json_object' })
  })

  it('json_schema builds the OpenAI shape', () => {
    const v = { type: 'json_schema' as const, schemaName: ' person ', schema: '{"type":"object"}', strict: false }
    expect(validateSchemaForm(v).ok).toBe(true)
    expect(buildResponseFormat(v)).toEqual({
      type: 'json_schema',
      json_schema: { name: 'person', schema: { type: 'object' }, strict: false },
    })
  })

  it('invalid schema or name is rejected and not sent', () => {
    const bad = { ...DEFAULT_RESPONSE_FORMAT, type: 'json_schema' as const, schema: '{"type": }' }
    expect(validateSchemaForm(bad).ok).toBe(false)
    expect(buildResponseFormat(bad)).toBeUndefined()
    expect(validateSchemaForm({ ...bad, schema: '[1]' }).error).toBe('The schema must be a JSON object')
    expect(validateSchemaForm({ ...bad, schema: '{}', schemaName: 'has space' }).ok).toBe(false)
  })
})

describe('prettyJsonReply', () => {
  it('pretty-prints JSON objects, arrays and fenced JSON', () => {
    expect(prettyJsonReply('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJsonReply('```json\n[1,2]\n```')).toBe('[\n  1,\n  2\n]')
  })
  it('returns null for prose and invalid JSON', () => {
    expect(prettyJsonReply('Hello')).toBeNull()
    expect(prettyJsonReply('{"a":')).toBeNull()
    expect(prettyJsonReply('42')).toBeNull()
  })
})

describe('compare metrics helpers', () => {
  it('estimateCost needs tokens and non-zero pricing', () => {
    const m = { latencyMs: 1, promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }
    expect(estimateCost(m, { inputPer1m: 2, outputPer1m: 4 })).toBeCloseTo(0.004)
    expect(estimateCost(m, { inputPer1m: 0, outputPer1m: 0 })).toBeUndefined()
    expect(estimateCost({ latencyMs: 1 }, { inputPer1m: 2, outputPer1m: 4 })).toBeUndefined()
    expect(estimateCost(m, undefined)).toBeUndefined()
  })
  it('formatCost', () => {
    expect(formatCost(0.004)).toBe('$0.0040')
    expect(formatCost(0.1234)).toBe('$0.123')
    expect(formatCost(0.00001)).toBe('<$0.0001')
  })
  it('bestIndex needs two values and a single winner', () => {
    expect(bestIndex([3, undefined, 1])).toBe(2)
    expect(bestIndex([3, undefined])).toBeNull()
    expect(bestIndex([1, 1])).toBeNull()
  })
})
