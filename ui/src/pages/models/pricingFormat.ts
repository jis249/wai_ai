import type { PricingAction, PricingPreviewRow } from '../../hooks/usePricingSync'

/** "$2.50" style USD per 1M tokens; keeps up to 4 decimals for cheap models. */
export function formatPer1m(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  const digits = abs !== 0 && abs < 0.01 ? 4 : abs < 1 ? 3 : 2
  let s = value.toFixed(digits)
  // Trim trailing zeros past the cents: 0.660 -> 0.66, 0.0200 -> 0.02.
  while (s.length > 0 && s.endsWith('0') && s.length - s.indexOf('.') - 1 > 2) s = s.slice(0, -1)
  return `$${s}`
}

export interface PriceChange {
  from: string
  to: string
  /** "up", "down" or "same" — shown as text so the change never relies on colour alone. */
  direction: 'up' | 'down' | 'same'
  delta: string
}

export function priceChange(current: number, next: number | null): PriceChange | null {
  if (next == null) return null
  const diff = Math.round((next - current) * 1e6) / 1e6
  return {
    from: formatPer1m(current),
    to: formatPer1m(next),
    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same',
    delta: formatPer1m(Math.abs(diff)),
  }
}

export const ACTION_LABELS: Record<PricingAction, string> = {
  update: 'Update',
  unchanged: 'Unchanged',
  no_match: 'No match',
  manual_locked: 'Manual (locked)',
}

export const ACTION_BADGE: Record<PricingAction, 'default' | 'success' | 'warning' | 'muted' | 'info'> = {
  update: 'default',
  unchanged: 'success',
  no_match: 'muted',
  manual_locked: 'warning',
}

/** Rows the admin can apply: a priced catalog match that differs from the current price. */
export function isSelectable(row: PricingPreviewRow): boolean {
  return row.action === 'update' || row.action === 'manual_locked'
}

export function rowMatchesSearch(row: PricingPreviewRow, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return [row.name, row.provider, row.match_key, row.pricing_key].some((v) => v?.toLowerCase().includes(q))
}
