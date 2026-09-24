import type { MessageMetrics } from './useChatStream'

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}

/** "TTFT 210ms · 1.84s · 12 → 96 tokens" (only the parts the API reported). */
export function formatMetrics(m: MessageMetrics): string {
  const parts: string[] = []
  if (m.ttftMs !== undefined) parts.push(`TTFT ${formatMs(m.ttftMs)}`)
  parts.push(formatMs(m.latencyMs))
  if (m.totalTokens !== undefined) {
    parts.push(`${(m.promptTokens ?? 0).toLocaleString()} → ${(m.completionTokens ?? 0).toLocaleString()} tokens`)
  }
  if (m.stopped) parts.push('stopped')
  return parts.join(' · ')
}
