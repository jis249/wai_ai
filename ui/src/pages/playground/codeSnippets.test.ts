import { describe, it, expect } from 'vitest'
import {
  buildCurlSnippet,
  buildJavaScriptSnippet,
  buildPythonSnippet,
  maskKey,
  playgroundSnippetParams,
  resolveProxyBaseUrl,
} from './codeSnippets'
import type { ChatSnippetParams } from './codeSnippets'

const base: ChatSnippetParams = {
  baseUrl: 'https://ai.waiin.com/v1',
  apiKey: 'wa_uk_...',
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: `It's "quoted"` },
  ],
  temperature: 0.7,
  maxTokens: 256,
}

describe('resolveProxyBaseUrl', () => {
  it('keeps a non-localhost configured URL', () => {
    expect(
      resolveProxyBaseUrl('https://proxy.example.com/v1', { origin: 'https://ai.waiin.com', hostname: 'ai.waiin.com' }),
    ).toBe('https://proxy.example.com/v1')
  })
  it('uses the dashboard origin when config is localhost but the app is not', () => {
    expect(
      resolveProxyBaseUrl('http://localhost:8081/v1', { origin: 'https://ai.waiin.com', hostname: 'ai.waiin.com' }),
    ).toBe('https://ai.waiin.com/v1')
  })
  it('keeps localhost config when the app itself runs on localhost', () => {
    expect(resolveProxyBaseUrl('http://localhost:8081/v1', { origin: 'http://localhost:5173', hostname: 'localhost' })).toBe(
      'http://localhost:8081/v1',
    )
  })
})

describe('maskKey', () => {
  it('shows only the type prefix', () => {
    expect(maskKey('wa_uk_abcdef123456')).toBe('wa_uk_...')
    expect(maskKey('sk-verysecretvalue')).toBe('sk-ver...')
    expect(maskKey('   ')).toBe('YOUR_API_KEY')
  })
})

describe('snippets', () => {
  it('curl: posts the JSON body with shell-escaped single quotes', () => {
    const s = buildCurlSnippet(base)
    expect(s).toContain(`curl 'https://ai.waiin.com/v1/chat/completions'`)
    expect(s).toContain(`-H 'Authorization: Bearer wa_uk_...'`)
    expect(s).toContain(`It'\\''s`)
    expect(s).toContain('"max_tokens": 256')
    expect(s).not.toContain('"stream"')
  })

  it('python: uses the OpenAI SDK with base_url', () => {
    const s = buildPythonSnippet({ ...base, stream: true })
    expect(s).toContain('from openai import OpenAI')
    expect(s).toContain('base_url="https://ai.waiin.com/v1"')
    expect(s).toContain('api_key="wa_uk_..."')
    expect(s).toContain(`{"role": "user", "content": "It's \\"quoted\\""}`)
    expect(s).toContain('stream=True')
    expect(s).toContain('for chunk in response:')
  })

  it('javascript: uses the OpenAI SDK with baseURL', () => {
    const s = buildJavaScriptSnippet(base)
    expect(s).toContain(`import OpenAI from 'openai'`)
    expect(s).toContain('baseURL: "https://ai.waiin.com/v1"')
    expect(s).toContain('temperature: 0.7')
    expect(s).toContain('max_tokens: 256')
    expect(s).toContain('console.log(response.choices[0].message.content)')
  })
})

describe('playgroundSnippetParams', () => {
  const params = { systemPrompt: 'Sys', temperature: 1, maxTokens: 10, stream: false, apiKey: 'wa_tk_realsecret' }

  it('never includes the full key and uses the conversation', () => {
    const p = playgroundSnippetParams(
      'm',
      params,
      [
        { id: '1', role: 'user', content: 'Q' },
        { id: '2', role: 'assistant', content: 'A' },
      ],
      'https://x/v1',
    )
    expect(p.apiKey).toBe('wa_tk_...')
    expect(JSON.stringify(p)).not.toContain('realsecret')
    expect(p.messages).toEqual([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'A' },
    ])
  })

  it('falls back to a placeholder key and a sample message', () => {
    const p = playgroundSnippetParams('', { ...params, apiKey: '', systemPrompt: '' }, [], 'https://x/v1')
    expect(p.apiKey).toBe('YOUR_API_KEY')
    expect(p.model).toBe('your-model-name')
    expect(p.messages).toEqual([{ role: 'user', content: 'Hello!' }])
  })
})
