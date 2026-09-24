import { LOCAL_STORAGE_KEY } from '../../lib/constants'

/** Extract a human message from an OpenAI-style / WAI proxy error body. */
export function parseProxyError(body: unknown, status: number, statusText: string): string {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown; message?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message
    }
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return `HTTP ${status}: ${statusText}`
}

export function truncateError(message: string, max = 200): string {
  return message.length > max ? message.slice(0, max) + '...' : message
}

/** Explicit key override, else the dashboard session key. */
export function playgroundToken(apiKey: string): string {
  return apiKey.trim() || localStorage.getItem(LOCAL_STORAGE_KEY) || ''
}

export async function fetchEmbeddings(model: string, apiKey: string, input: string | string[]): Promise<number[][]> {
  const res = await fetch('/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${playgroundToken(apiKey)}`,
    },
    body: JSON.stringify({ model, input }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(truncateError(parseProxyError(body, res.status, res.statusText)))
  }
  const data = (await res.json()) as { data?: { embedding?: number[] }[] }
  return (data.data ?? []).map((d) => d.embedding ?? [])
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
