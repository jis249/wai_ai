import { describe, it, expect } from 'vitest'
import { anthropicBaseUrl, buildAnthropicPythonSnippet, buildChatSnippet } from './codeSnippets'

const base = {
  baseUrl: 'https://ai.waiin.com/v1',
  apiKey: 'wa_uk_...',
  model: 'claude-alias',
  messages: [
    { role: 'system' as const, content: 'Be brief.' },
    { role: 'user' as const, content: 'Hello!' },
  ],
}

describe('Anthropic SDK snippet', () => {
  it('uses the origin without /v1 as base_url', () => {
    expect(anthropicBaseUrl('https://ai.waiin.com/v1')).toBe('https://ai.waiin.com')
    expect(anthropicBaseUrl('https://ai.waiin.com/v1/')).toBe('https://ai.waiin.com')
    expect(anthropicBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
  })

  it('builds a messages.create call with system, max_tokens and no system role in messages', () => {
    const code = buildAnthropicPythonSnippet(base)
    expect(code).toContain('import anthropic')
    expect(code).toContain('anthropic.Anthropic(')
    expect(code).toContain('base_url="https://ai.waiin.com",')
    expect(code).toContain('api_key="wa_uk_..."')
    expect(code).toContain('max_tokens=1024,')
    expect(code).toContain('system="Be brief.",')
    expect(code).not.toContain('"role": "system"')
    expect(code).toContain('print(message.content[0].text)')
  })

  it('streams with messages.stream and honours maxTokens/temperature', () => {
    const code = buildChatSnippet('anthropic', { ...base, stream: true, maxTokens: 256, temperature: 0.3 })
    expect(code).toContain('with client.messages.stream(')
    expect(code).toContain('max_tokens=256,')
    expect(code).toContain('temperature=0.3,')
    expect(code).toContain('for text in stream.text_stream:')
  })
})
