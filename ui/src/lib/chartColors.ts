import { useSyncExternalStore } from 'react'

/**
 * Theme-aware chart colors.
 *
 * All values are CSS variables defined in `styles/globals.css` (dark in `:root`,
 * light in `[data-theme="light"]`). Prefer the `var(...)` strings - SVG/recharts
 * attributes and inline styles resolve them live, so charts re-theme without a
 * re-render. Use `useChartPalette()` only when a concrete hex is required
 * (canvas, color math, third-party libs that parse colors).
 */

export const CHART_SERIES_COUNT = 8

/** CSS custom property names of the categorical series, in fixed order. */
export const CHART_COLOR_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
] as const

/** `var(--chart-N)` strings in fixed order - safe to pass as `stroke`/`fill`/`background`. */
export const CHART_COLORS: readonly string[] = CHART_COLOR_VARS.map((v) => `var(${v})`)

/**
 * Series color for index `i` (0-based). Wraps after 8 — callers with more than
 * 8 series should fold the tail into "Other" rather than rely on wrapping.
 */
export function chartColor(i: number): string {
  const n = ((Math.trunc(i) % CHART_SERIES_COUNT) + CHART_SERIES_COUNT) % CHART_SERIES_COUNT
  return CHART_COLORS[n]
}

/** Neutral chart chrome as CSS `var(...)` strings. */
export const CHART_CHROME = {
  grid: 'var(--chart-grid)',
  cursor: 'var(--chart-cursor)',
  track: 'var(--chart-track)',
  tick: 'var(--color-text-tertiary)',
  surface: 'var(--color-bg-secondary)',
  tooltip: {
    bg: 'var(--color-bg-secondary)',
    border: 'var(--color-border)',
    label: 'var(--color-text-tertiary)',
    value: 'var(--color-text-primary)',
  },
} as const

/**
 * `color` blended with transparency via CSS color-mix — works with `var(...)` inputs.
 * `alpha` is 0..1.
 */
export function withAlpha(color: string, alpha: number): string {
  const pct = Math.round(Math.min(Math.max(alpha, 0), 1) * 100)
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/** Read a CSS custom property from <html> (returns '' outside the browser). */
export function readCssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export interface ResolvedChartPalette {
  series: string[]
  grid: string
  cursor: string
  track: string
  tick: string
  surface: string
}

function readPalette(): ResolvedChartPalette {
  return {
    series: CHART_COLOR_VARS.map(readCssVar),
    grid: readCssVar('--chart-grid'),
    cursor: readCssVar('--chart-cursor'),
    track: readCssVar('--chart-track'),
    tick: readCssVar('--color-text-tertiary'),
    surface: readCssVar('--color-bg-secondary'),
  }
}

let cachedKey = ''
let cachedPalette: ResolvedChartPalette | null = null

function getSnapshot(): ResolvedChartPalette {
  const key = typeof document === 'undefined' ? '' : (document.documentElement.getAttribute('data-theme') ?? '')
  if (cachedPalette == null || key !== cachedKey) {
    cachedKey = key
    cachedPalette = readPalette()
  }
  return cachedPalette
}

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/**
 * Resolved (computed) chart colors for the active theme. Updates when the
 * `data-theme` attribute on <html> changes.
 */
export function useChartPalette(): ResolvedChartPalette {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
