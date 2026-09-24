/**
 * KPI period-over-period deltas and their colour semantics.
 *
 * - `kind: 'relative'` (counts, cost, latency): percent change vs the previous value.
 * - `kind: 'points'` (rates stored as 0..1 fractions): difference in percentage points,
 *   so 1% -> 2% reads "+1.0 pts" rather than a misleading "+100%".
 *
 * `goodWhen` says which direction is desirable. 'down' is for error rate / latency
 * (up is bad), 'neutral' for metrics where more is neither good nor bad (tokens, cost).
 */

export type KpiGoodWhen = 'up' | 'down' | 'neutral'
export type KpiDeltaKind = 'relative' | 'points'
export type KpiDirection = 'up' | 'down' | 'flat'
export type KpiTone = 'good' | 'bad' | 'neutral'

export interface KpiDelta {
  direction: KpiDirection
  /** Magnitude (percent for 'relative', percentage points for 'points'); null when not computable. */
  magnitude: number | null
  /** 'new' when the previous period was zero and this one is not. */
  isNew: boolean
  tone: KpiTone
  /** Visible text, e.g. "12%", "1.5 pts", "New", "0%". */
  label: string
  /** Screen-reader sentence, e.g. "Up 12% vs previous period (worse)". */
  srText: string
}

const EPSILON = 1e-9

function formatMagnitude(n: number): string {
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs < 10) return abs.toFixed(1)
  return Math.round(abs).toLocaleString()
}

export function kpiTone(direction: KpiDirection, goodWhen: KpiGoodWhen): KpiTone {
  if (direction === 'flat' || goodWhen === 'neutral') return 'neutral'
  return direction === goodWhen ? 'good' : 'bad'
}

export function computeKpiDelta(
  current: number,
  previous: number,
  { kind = 'relative', goodWhen = 'up' }: { kind?: KpiDeltaKind; goodWhen?: KpiGoodWhen } = {},
): KpiDelta {
  const cur = Number.isFinite(current) ? current : 0
  const prev = Number.isFinite(previous) ? previous : 0

  let magnitude: number | null
  let isNew = false
  if (kind === 'points') {
    magnitude = (cur - prev) * 100
  } else if (Math.abs(prev) < EPSILON) {
    magnitude = Math.abs(cur) < EPSILON ? 0 : null
    isNew = magnitude == null
  } else {
    magnitude = ((cur - prev) / Math.abs(prev)) * 100
  }

  // Treat tiny changes that would render as 0.0 as flat.
  const direction: KpiDirection = isNew
    ? 'up'
    : magnitude == null || Math.abs(magnitude) < 0.05
      ? 'flat'
      : magnitude > 0
        ? 'up'
        : 'down'
  const tone = kpiTone(direction, goodWhen)
  const unit = kind === 'points' ? ' pts' : '%'
  const srUnit = kind === 'points' ? ' percentage points' : '%'

  let label: string
  let srText: string
  if (isNew) {
    label = 'New'
    srText = 'New this period (none in previous period)'
  } else if (direction === 'flat') {
    label = `0${unit}`
    srText = 'No change vs previous period'
  } else {
    const m = formatMagnitude(magnitude ?? 0)
    label = `${m}${unit}`
    const verdict = tone === 'good' ? ' (better)' : tone === 'bad' ? ' (worse)' : ''
    srText = `${direction === 'up' ? 'Up' : 'Down'} ${m}${srUnit} vs previous period${verdict}`
  }
  return { direction, magnitude: magnitude == null ? null : Math.abs(magnitude), isNew, tone, label, srText }
}

/** Tailwind text class for a delta tone (tokens only). */
export function kpiToneClass(tone: KpiTone): string {
  if (tone === 'good') return 'text-success'
  if (tone === 'bad') return 'text-error'
  return 'text-text-tertiary'
}
