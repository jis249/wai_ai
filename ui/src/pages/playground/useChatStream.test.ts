import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useChatStream } from './useChatStream'
import type { ChatParams } from './useChatStream'

const params: ChatParams = {
  model: 'gpt-test',
  systemPrompt: 'Be brief.',
  temperature: 0.5,
  maxTokens: 64,
  stream: true,
  apiKey: 'wa_uk_secret',
}

const encoder = new TextEncoder()

/** Fake fetch Response whose body yields the given SSE chunks, optionally hanging until aborted. */
function sseResponse(chunks: string[], opts: { hangAfter?: number; signal?: AbortSignal } = {}) {
  let i = 0
  const reader = {
    read: vi.fn(async () => {
      if (opts.hangAfter !== undefined && i >= opts.hangAfter) {
        await new Promise<void>((_, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }
      if (i < chunks.length) return { done: false, value: encoder.encode(chunks[i++]) }
      return { done: true, value: undefined }
    }),
    releaseLock: vi.fn(),
  }
  return { ok: true, status: 200, statusText: 'OK', body: { getReader: () => reader }, json: async () => ({}) }
}

function delta(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1]
  return JSON.parse(init.body as string)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useChatStream', () => {
  it('streams SSE deltas into an assistant message with usage, TTFT and latency', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        delta('Hel'),
        // A frame split across reads must still parse.
        'data: {"choices":[{"delta":{"content":"lo"}}]',
        '}\n\n',
        `data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    let t = 0
    const { result } = renderHook(() => useChatStream({ now: () => (t += 100) }))

    await act(async () => {
      await result.current.send('  Hi  ', params)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer wa_uk_secret')
    expect(bodyOf(fetchMock)).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
      ],
      stream: true,
      temperature: 0.5,
      max_tokens: 64,
    })

    const msgs = result.current.messages
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello'],
    ])
    const metrics = msgs[1].metrics!
    expect(metrics.ttftMs).toBeGreaterThan(0)
    expect(metrics.latencyMs).toBeGreaterThan(metrics.ttftMs!)
    expect(metrics).toMatchObject({ promptTokens: 5, completionTokens: 2, totalTokens: 7 })
    expect(result.current.usage).toMatchObject({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('sends prior turns on the next request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([delta('One')])))
    const { result } = renderHook(() => useChatStream())
    await act(async () => {
      await result.current.send('first', params)
    })
    const fetchMock = vi.fn(async () => sseResponse([delta('Two')]))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => {
      await result.current.send('second', params)
    })
    expect(bodyOf(fetchMock).messages.map((m: { content: string }) => m.content)).toEqual([
      'Be brief.',
      'first',
      'One',
      'second',
    ])
  })

  it('stop() aborts the stream, keeps partial content and marks the reply stopped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => sseResponse([delta('Partial')], { hangAfter: 1, signal: init.signal! })),
    )
    const { result } = renderHook(() => useChatStream())

    let pending!: Promise<void>
    act(() => {
      pending = result.current.send('Hi', params)
    })
    await waitFor(() => expect(result.current.messages[1]?.content).toBe('Partial'))
    expect(result.current.isStreaming).toBe(true)

    await act(async () => {
      result.current.stop()
      await pending
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.messages[1]).toMatchObject({ content: 'Partial', metrics: { stopped: true } })
  })

  it('surfaces proxy errors and does not add an assistant message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: { message: 'model not allowed' } }),
      })),
    )
    const { result } = renderHook(() => useChatStream())
    await act(async () => {
      await result.current.send('Hi', params)
    })
    expect(result.current.error).toBe('model not allowed')
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.isStreaming).toBe(false)
  })

  it('handles non-streaming responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [{ message: { content: 'Full reply' } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
      })),
    )
    const { result } = renderHook(() => useChatStream())
    await act(async () => {
      await result.current.send('Hi', { ...params, stream: false })
    })
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'Full reply' })
    expect(result.current.messages[1].metrics?.ttftMs).toBeUndefined()
    expect(result.current.metrics?.totalTokens).toBe(7)
  })

  it('adds response_format only when given', async () => {
    const fetchMock = vi.fn(async () => sseResponse([delta('{}')]))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatStream())
    await act(async () => {
      await result.current.send('first', params)
    })
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty('response_format')
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: { name: 'r', schema: { type: 'object' }, strict: true },
    }
    await act(async () => {
      await result.current.send('second', { ...params, responseFormat })
    })
    expect(bodyOf(fetchMock, 1).response_format).toEqual(responseFormat)
  })
})
