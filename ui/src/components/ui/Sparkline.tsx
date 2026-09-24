import { cn } from '../../lib/utils'
import { withAlpha } from '../../lib/chartColors'

export interface SparklineProps {
  /** Series values, oldest first. Non-finite values are treated as 0. */
  values: readonly number[]
  /** Rendered height in px (the width fills the container). */
  height?: number
  /** Stroke color; any CSS color or `var(--chart-N)`. */
  color?: string
  /** Soft area fill under the line. */
  fill?: boolean
  className?: string
}

/** Internal coordinate space; the SVG stretches it to the container. */
const SPARKLINE_WIDTH = 100
const PAD = 2

/**
 * Map values to "x,y" points in a `SPARKLINE_WIDTH` x `height` box (y grows downward).
 * A flat series (or a single value) draws a line through the vertical middle.
 */
function sparklinePoints(values: readonly number[], height: number): [number, number][] {
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0))
  if (clean.length === 0) return []
  const series = clean.length === 1 ? [clean[0], clean[0]] : clean
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min
  const innerH = Math.max(height - PAD * 2, 1)
  const step = SPARKLINE_WIDTH / (series.length - 1)
  return series.map((v, i) => {
    const x = i * step
    const y = span === 0 ? height / 2 : PAD + innerH - ((v - min) / span) * innerH
    return [round(x), round(y)]
  })
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Tiny trend line (no axes, no interaction). Decorative: it is `aria-hidden`, so
 * callers must expose the underlying numbers as text (e.g. an sr-only summary).
 */
export function Sparkline({ values, height = 32, color = 'var(--chart-1)', fill = true, className }: SparklineProps) {
  const pts = sparklinePoints(values, height)
  if (pts.length === 0) return null
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const area = `${line} L${SPARKLINE_WIDTH} ${height} L0 ${height} Z`
  return (
    <svg
      data-testid="sparkline"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={cn('block overflow-visible', className)}
    >
      {fill && <path d={area} fill={withAlpha(color, 0.12)} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
