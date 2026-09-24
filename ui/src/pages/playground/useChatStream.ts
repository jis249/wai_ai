import { useCallback, useEffect, useRef, useState } from 'react'
import { parseProxyError, playgroundToken, truncateError } from './proxy'

export interface ChatParams {
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  stream: boolean
  /** Optional key override; empty uses the dashboard session. */
  apiKey: string
}

export interface MessageMetrics {
  /** Request start → last byte (ms). */
  latencyMs: number
  /** Request start → first content delta (ms); streaming only. */
  ttftMs?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  /** The user pressed Stop before the reply finished. */
  stopped?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  metrics?: MessageMetrics
}

export interface UsageInfo {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Seconds. */
  duration: number
}

interface WireUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export const MAX_MESSAGES = 50

export interface UseChatStreamOptions {
  maxMessages?: number
  /** Clock in ms (injectable for tests). */
  now?: () => number
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError'
}

function usageMetrics(u: WireUsage | null | undefined): Pick<MessageMetrics, 'promptTokens' | 'completionTokens' | 'totalTokens'> {
  if (!u) return {}
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  }
}

/**
 * Chat completions against the WAI proxy (`POST /v1/chat/completions`), with SSE streaming,
 * Stop (AbortController) and per-reply latency / TTFT / token metrics.
 */
export function useChatStream(options: UseChatStreamOptions = {}) {
  const { maxMessages = MAX_MESSAGES } = options
  const nowRef = useRef(options.now ?? (() => performance.now()))

  const [messages, setMessagesState] = useState<ChatMessage[]>([])
  // Source of truth for request building (state mirrors it for rendering).
  const messagesRef = useRef<ChatMessage[]>([])
  const setMessages = useCallback((update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    const next = typeof update === 'function' ? update(messagesRef.current) : update
    messagesRef.current = next
    setMessagesState(next)
  }, [])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => () => abortRef.current?.abort(), [])

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [setMessages])

  const send = useCallback(
    async (content: string, params: ChatParams) => {
      const text = content.trim()
      if (!params.model || !text || inFlightRef.current) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      inFlightRef.current = true

      const userMessage: ChatMessage = { id: newId(), role: 'user', content: text }
      const newHistory = [...messagesRef.current, userMessage].slice(-maxMessages)
      setMessages(newHistory)
      setIsStreaming(true)
      setError(null)

      const payloadMessages = [
        ...(params.systemPrompt.trim() ? [{ role: 'system' as const, content: params.systemPrompt.trim() }] : []),
        ...newHistory.map(({ role, content: c }) => ({ role, content: c })),
      ]

      const now = nowRef.current
      const start = now()
      let assistantId: string | null = null
      let fullContent = ''
      let ttftMs: number | undefined
      let finalUsage: WireUsage | null = null

      const finish = (stopped: boolean) => {
        const latencyMs = now() - start
        const metrics: MessageMetrics = { latencyMs, ...usageMetrics(finalUsage), ...(ttftMs !== undefined ? { ttftMs } : {}) }
        if (stopped) metrics.stopped = true
        if (assistantId) patchMessage(assistantId, { content: fullContent, metrics })
        setUsage(
          finalUsage
            ? {
                prompt_tokens: finalUsage.prompt_tokens ?? 0,
                completion_tokens: finalUsage.completion_tokens ?? 0,
                total_tokens: finalUsage.total_tokens ?? 0,
                duration: latencyMs / 1000,
              }
            : null,
        )
      }

      try {
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${playgroundToken(params.apiKey)}`,
          },
          body: JSON.stringify({
            model: params.model,
            messages: payloadMessages,
            stream: params.stream,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
          }),
          signal: controller.signal,
        })

        if (res.status === 401) {
          const body = await res.json().catch(() => null)
          const code =
            body && typeof body === 'object' && body.error && typeof body.error === 'object'
              ? (body.error as { code?: string }).code
              : undefined
          setError(
            code === 'unauthorized'
              ? 'Session expired or invalid. Log in again or paste a user/team API key in settings.'
              : parseProxyError(body, res.status, res.statusText) ||
                  'Upstream authentication failed. Check the model API key in Models settings.',
          )
          return
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null)
          setError(truncateError(parseProxyError(body, res.status, res.statusText)))
          return
        }

        if (params.stream) {
          const reader = res.body?.getReader()
          if (!reader) {
            setError('Streaming not supported')
            return
          }
          const decoder = new TextDecoder()
          let buffer = ''
          const id = newId()
          assistantId = id
          setMessages((prev) => [...prev, { id, role: 'assistant', content: '' }])

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() ?? ''

              let chunkContent = ''
              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue
                try {
                  const json = JSON.parse(trimmed.slice(6)) as {
                    choices?: { delta?: { content?: string } }[]
                    usage?: WireUsage
                  }
                  const delta = json.choices?.[0]?.delta?.content
                  if (delta) chunkContent += delta
                  if (json.usage) finalUsage = json.usage
                } catch {
                  // Skip unparseable SSE lines
                }
              }

              if (chunkContent) {
                if (ttftMs === undefined) ttftMs = now() - start
                fullContent += chunkContent
                patchMessage(id, { content: fullContent })
              }
            }
          } finally {
            reader.releaseLock()
          }
          finish(false)
        } else {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[]
            usage?: WireUsage
          }
          fullContent = data.choices?.[0]?.message?.content ?? ''
          finalUsage = data.usage ?? null
          const id = newId()
          assistantId = id
          setMessages((prev) => [...prev, { id, role: 'assistant', content: fullContent }])
          finish(false)
        }
      } catch (err) {
        if (isAbortError(err)) {
          if (controller === abortRef.current) finish(true)
          return
        }
        setError(truncateError(err instanceof Error ? err.message : 'Request failed'))
      } finally {
        if (controller === abortRef.current) {
          inFlightRef.current = false
          setIsStreaming(false)
        }
      }
    },
    [maxMessages, patchMessage, setMessages],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    setIsStreaming(false)
    setMessages([])
    setUsage(null)
    setError(null)
  }, [setMessages])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

  return {
    messages,
    send,
    stop,
    clear,
    isStreaming,
    error,
    setError,
    /** Token usage + duration of the last completed reply (null when the API sent none). */
    usage,
    /** Metrics of the latest assistant reply. */
    metrics: lastAssistant?.metrics ?? null,
  }
}
