/** Structured output ("Response format") for chat completions, OpenAI wire format. */

export type ResponseFormatType = 'text' | 'json_object' | 'json_schema'

export interface ResponseFormatValue {
  type: ResponseFormatType
  /** json_schema only. */
  schemaName: string
  /** json_schema only: the JSON Schema as text (edited in a textarea). */
  schema: string
  /** json_schema only. */
  strict: boolean
}

/** OpenAI `response_format` request field. */
export type ResponseFormatWire =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } }

export const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {
    "answer": { "type": "string" }
  },
  "required": ["answer"],
  "additionalProperties": false
}`

export const DEFAULT_RESPONSE_FORMAT: ResponseFormatValue = {
  type: 'text',
  schemaName: 'response',
  schema: DEFAULT_SCHEMA,
  strict: true,
}

export interface JsonValidation {
  ok: boolean
  error?: string
  /** 1-based line of the parse error, when it can be located. */
  line?: number
  column?: number
}

/** 1-based line/column of a 0-based character offset. */
export function lineColumnAt(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(position, text.length)))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/** Parse JSON text and describe the first error with its line (engines report a position or line/column). */
export function validateJson(text: string): JsonValidation & { value?: unknown } {
  if (!text.trim()) return { ok: false, error: 'Enter a JSON schema' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON'
    const lc = /line (\d+) column (\d+)/i.exec(message)
    if (lc) return { ok: false, error: message, line: Number(lc[1]), column: Number(lc[2]) }
    const pos = /position (\d+)/i.exec(message)
    if (pos) return { ok: false, error: message, ...lineColumnAt(text, Number(pos[1])) }
    // Unexpected end of input: point at the last line.
    if (/end of (json )?input|unterminated/i.test(message)) {
      return { ok: false, error: message, ...lineColumnAt(text, text.length) }
    }
    return { ok: false, error: message }
  }
}

const SCHEMA_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

/** Validate the JSON-schema form: parseable JSON object and an OpenAI-compatible name. */
export function validateSchemaForm(value: ResponseFormatValue): JsonValidation {
  if (value.type !== 'json_schema') return { ok: true }
  const parsed = validateJson(value.schema)
  if (!parsed.ok) return parsed
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { ok: false, error: 'The schema must be a JSON object' }
  }
  if (!SCHEMA_NAME_RE.test(value.schemaName.trim())) {
    return { ok: false, error: 'Schema name: 1–64 letters, digits, _ or -' }
  }
  return { ok: true }
}

/** The `response_format` to send, or undefined for plain text (or an invalid schema). */
export function buildResponseFormat(value: ResponseFormatValue | undefined): ResponseFormatWire | undefined {
  if (!value || value.type === 'text') return undefined
  if (value.type === 'json_object') return { type: 'json_object' }
  if (!validateSchemaForm(value).ok) return undefined
  return {
    type: 'json_schema',
    json_schema: {
      name: value.schemaName.trim(),
      schema: JSON.parse(value.schema) as Record<string, unknown>,
      strict: value.strict,
    },
  }
}

/**
 * If a reply is a JSON object/array (optionally inside a single ```json fence), return it
 * pretty-printed; otherwise null.
 */
export function prettyJsonReply(content: string): string | null {
  let text = content.trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text)
  if (fence) text = fence[1].trim()
  if (!(text.startsWith('{') || text.startsWith('['))) return null
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}
