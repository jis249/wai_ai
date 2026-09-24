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

export interface ModelPricing {
  /** USD per 1M prompt tokens. */
  inputPer1m: number
  /** USD per 1M completion tokens. */
  outputPer1m: number
}

/** Estimated USD cost of one reply; undefined without token counts or configured (non-zero) pricing. */
export function estimateCost(m: MessageMetrics | null | undefined, pricing: ModelPricing | undefined): number | undefined {
  if (!m || !pricing || m.totalTokens === undefined) return undefined
  if (!(pricing.inputPer1m > 0) && !(pricing.outputPer1m > 0)) return undefined
  return ((m.promptTokens ?? 0) * pricing.inputPer1m + (m.completionTokens ?? 0) * pricing.outputPer1m) / 1_000_000
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3)}`
}

/** Index of the smallest value, only when at least two entries are defined and there is a single winner. */
export function bestIndex(values: (number | undefined)[]): number | null {
  const defined = values.map((v, i) => [v, i] as const).filter((e): e is readonly [number, number] => e[0] !== undefined)
  if (defined.length < 2) return null
  const min = Math.min(...defined.map(([v]) => v))
  const winners = defined.filter(([v]) => v === min)
  return winners.length === 1 ? winners[0][1] : null
}
