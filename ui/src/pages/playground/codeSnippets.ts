import { KEY_PREFIXES } from '../../lib/constants'
import type { ParametersValue } from './ParametersPanel'
import type { ChatMessage } from './useChatStream'
import { buildResponseFormat } from './responseFormat'
import type { ResponseFormatWire } from './responseFormat'

export type SnippetLanguage = 'curl' | 'python' | 'javascript' | 'anthropic'

export interface SnippetMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatSnippetParams {
  baseUrl: string
  /** Rendered verbatim: pass a masked key or a placeholder, never a secret you do not intend to show. */
  apiKey: string
  model: string
  messages: SnippetMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  /** OpenAI `response_format`; omitted when undefined. */
  responseFormat?: ResponseFormatWire
}

export const API_KEY_PLACEHOLDER = 'YOUR_API_KEY'
export const DEFAULT_SNIPPET_MESSAGES: SnippetMessage[] = [{ role: 'user', content: 'Hello!' }]

export { resolveProxyBaseUrl } from '../../lib/proxyUrl'

/** Show only the key's type prefix (e.g. `wa_uk_...`); unknown keys keep at most 6 chars. */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return API_KEY_PLACEHOLDER
  const prefix = Object.values(KEY_PREFIXES).find((p) => trimmed.startsWith(p)) ?? trimmed.slice(0, Math.min(6, trimmed.length))
  return `${prefix}...`
}

function requestBody(p: ChatSnippetParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model,
    messages: p.messages.map(({ role, content }) => ({ role, content })),
  }
  if (p.temperature !== undefined) body.temperature = p.temperature
  if (p.maxTokens !== undefined) body.max_tokens = p.maxTokens
  if (p.stream) body.stream = true
  if (p.responseFormat) body.response_format = p.responseFormat
  return body
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n')
}

export function buildCurlSnippet(p: ChatSnippetParams): string {
  const url = `${p.baseUrl.replace(/\/$/, '')}/chat/completions`
  const body = JSON.stringify(requestBody(p), null, 2)
  return [
    `curl ${shellSingleQuote(url)}${p.stream ? ' -N' : ''} \\`,
    `  -H ${shellSingleQuote(`Authorization: Bearer ${p.apiKey}`)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellSingleQuote(body)}`,
  ].join('\n')
}

/** JSON string literals are valid Python string literals for the characters JSON emits. */
function py(value: string): string {
  return JSON.stringify(value)
}

/** A JSON value as a Python literal (True/False/None), indented like the call arguments. */
export function pyLiteral(value: unknown, level = 1): string {
  const pad = '    '.repeat(level)
  const inner = '    '.repeat(level + 1)
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None'
  if (typeof value === 'string') return py(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => `${inner}${pyLiteral(v, level + 1)},`).join('\n')}\n${pad}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([k, v]) => `${inner}${py(k)}: ${pyLiteral(v, level + 1)},`).join('\n')}\n${pad}}`
}

export function buildPythonSnippet(p: ChatSnippetParams): string {
  const messages = p.messages
    .map(({ role, content }) => `        {"role": ${py(role)}, "content": ${py(content)}},`)
    .join('\n')
  const extra: string[] = []
  if (p.temperature !== undefined) extra.push(`    temperature=${p.temperature},`)
  if (p.maxTokens !== undefined) extra.push(`    max_tokens=${p.maxTokens},`)
  if (p.stream) extra.push('    stream=True,')
  if (p.responseFormat) extra.push(`    response_format=${pyLiteral(p.responseFormat, 1)},`)
  const output = p.stream
    ? [
        'for chunk in response:',
        '    if chunk.choices and chunk.choices[0].delta.content:',
        '        print(chunk.choices[0].delta.content, end="", flush=True)',
      ]
    : ['print(response.choices[0].message.content)']
  return [
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    `    base_url=${py(p.baseUrl)},`,
    `    api_key=${py(p.apiKey)},`,
    ')',
    '',
    'response = client.chat.completions.create(',
    `    model=${py(p.model)},`,
    '    messages=[',
    messages,
    '    ],',
    ...extra,
    ')',
    ...output,
  ].join('\n')
}

export function buildJavaScriptSnippet(p: ChatSnippetParams): string {
  const body = requestBody(p)
  const { model, messages, ...rest } = body
  const lines = [
    `  model: ${JSON.stringify(model)},`,
    `  messages: ${indent(JSON.stringify(messages, null, 2), 2)},`,
    ...Object.entries(rest).map(([k, v]) => `  ${k}: ${indent(JSON.stringify(v, null, typeof v === 'object' && v !== null ? 2 : undefined), 2)},`),
  ]
  const output = p.stream
    ? [
        'for await (const chunk of response) {',
        "  process.stdout.write(chunk.choices[0]?.delta?.content ?? '')",
        '}',
      ]
    : ['console.log(response.choices[0].message.content)']
  return [
    "import OpenAI from 'openai'",
    '',
    'const client = new OpenAI({',
    `  baseURL: ${JSON.stringify(p.baseUrl)},`,
    `  apiKey: ${JSON.stringify(p.apiKey)},`,
    '})',
    '',
    'const response = await client.chat.completions.create({',
    ...lines,
    '})',
    ...output,
  ].join('\n')
}

/** Anthropic SDKs take the server origin (no `/v1`) and append `/v1/messages` themselves. */
export function anthropicBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** Python snippet for the Anthropic-compatible `/v1/messages` endpoint. */
export function buildAnthropicPythonSnippet(p: ChatSnippetParams): string {
  const system = p.messages.filter((m) => m.role === 'system').map((m) => m.content)
  const turns = p.messages.filter((m) => m.role !== 'system')
  const messages = (turns.length ? turns : DEFAULT_SNIPPET_MESSAGES)
    .map(({ role, content }) => `        {"role": ${py(role)}, "content": ${py(content)}},`)
    .join('\n')
  const args = [
    `    model=${py(p.model)},`,
    `    max_tokens=${p.maxTokens ?? 1024},`,
    ...(system.length ? [`    system=${py(system.join('\n\n'))},`] : []),
    ...(p.temperature !== undefined ? [`    temperature=${p.temperature},`] : []),
    '    messages=[',
    messages,
    '    ],',
  ]
  const call = p.stream
    ? ['with client.messages.stream(', ...args, ') as stream:', '    for text in stream.text_stream:', '        print(text, end="", flush=True)']
    : ['message = client.messages.create(', ...args, ')', 'print(message.content[0].text)']
  return [
    'import anthropic',
    '',
    'client = anthropic.Anthropic(',
    `    base_url=${py(anthropicBaseUrl(p.baseUrl))},`,
    `    api_key=${py(p.apiKey)},`,
    ')',
    '',
    ...call,
  ].join('\n')
}

export function buildChatSnippet(language: SnippetLanguage, p: ChatSnippetParams): string {
  if (language === 'python') return buildPythonSnippet(p)
  if (language === 'anthropic') return buildAnthropicPythonSnippet(p)
  if (language === 'javascript') return buildJavaScriptSnippet(p)
  return buildCurlSnippet(p)
}

/** Snippet params from the playground state. The key is never shown in full. */
export function playgroundSnippetParams(
  model: string,
  params: ParametersValue,
  messages: ChatMessage[],
  baseUrl: string,
): ChatSnippetParams {
  const history: SnippetMessage[] = messages
    .filter((m) => m.content)
    .map(({ role, content }) => ({ role, content }))
  const responseFormat = buildResponseFormat(params.responseFormat)
  const system: SnippetMessage[] = params.systemPrompt.trim() ? [{ role: 'system', content: params.systemPrompt.trim() }] : []
  return {
    baseUrl,
    apiKey: params.apiKey.trim() ? maskKey(params.apiKey) : API_KEY_PLACEHOLDER,
    model: model || 'your-model-name',
    messages: [...system, ...(history.length ? history : DEFAULT_SNIPPET_MESSAGES)],
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    stream: params.stream,
    ...(responseFormat ? { responseFormat } : {}),
  }
}
