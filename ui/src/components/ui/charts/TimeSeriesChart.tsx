import { useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { CHART_CHROME, chartColor } from '../../../lib/chartColors'
import { cn } from '../../../lib/utils'

export interface TimeSeriesPoint {
  /** Axis tick label. */
  label: string
  /** Longer label for the tooltip / link text (defaults to `label`). */
  tooltipLabel?: string
  /** Current-period value; null leaves a gap (e.g. future days). */
  value: number | null
  /** Previous-period value aligned to this bucket (drawn dashed). */
  previous?: number | null
}

export interface TimeSeriesReferenceLine {
  value: number
  /** Legend / tooltip text, e.g. "Budget $500". */
  label: string
}

export interface TimeSeriesChartProps {
  data: readonly TimeSeriesPoint[]
  /** Accessible name for the chart (e.g. "Requests per hour"). */
  ariaLabel: string
  height?: number
  color?: string
  formatValue?: (n: number) => string
  /** Legend name of the current series. */
  seriesLabel?: string
  /** Legend name of the dashed comparison series. */
  previousLabel?: string
  /** Show the dashed previous-period series (needs `previous` on points). */
  showPrevious?: boolean
  /** Horizontal threshold line (e.g. a budget). */
  referenceLine?: TimeSeriesReferenceLine
  /** Drill-down target per bucket. Buckets become links (click, or Tab + arrows + Enter). */
  getPointHref?: (point: TimeSeriesPoint, index: number) => string
  /** Link text suffix, e.g. "view request logs". */
  pointActionLabel?: string
}

const PREVIOUS_COLOR = 'var(--color-text-tertiary)'
const REFERENCE_COLOR = 'var(--color-warning)'
const AXIS_HEIGHT = 24

function fmt(n: number | null | undefined, formatValue?: (n: number) => string): string {
  if (n == null) return '—'
  return formatValue ? formatValue(n) : n.toLocaleString()
}

function renderTooltip(
  props: TooltipContentProps<ValueType, NameType>,
  data: readonly TimeSeriesPoint[],
  opts: { formatValue?: (n: number) => string; seriesLabel: string; previousLabel: string; showPrevious: boolean; color: string },
) {
  const { active, payload } = props
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload as (TimeSeriesPoint & { index: number }) | undefined
  if (row == null) return null
  const point = data[row.index] ?? row
  return (
    <div
      style={{
        background: CHART_CHROME.tooltip.bg,
        border: `1px solid ${CHART_CHROME.tooltip.border}`,
        borderRadius: 8,
        padding: '8px 12px',
      }}
    >
      <p style={{ color: CHART_CHROME.tooltip.label, fontSize: 11, marginBottom: 4 }}>{point.tooltipLabel ?? point.label}</p>
      <p style={{ color: CHART_CHROME.tooltip.value, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden="true" style={{ width: 10, height: 2, background: opts.color, display: 'inline-block' }} />
        {opts.showPrevious ? `${opts.seriesLabel}: ` : ''}
        {fmt(point.value, opts.formatValue)}
      </p>
      {opts.showPrevious && (
        <p style={{ color: CHART_CHROME.tooltip.label, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true" style={{ width: 10, borderTop: `2px dashed ${PREVIOUS_COLOR}`, display: 'inline-block' }} />
          {opts.previousLabel}: {fmt(point.previous, opts.formatValue)}
        </p>
      )}
    </div>
  )
}

function LegendSwatch({ kind, color }: { kind: 'solid' | 'dashed' | 'dotted'; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-4"
      style={{ borderTop: `2px ${kind} ${color}` }}
    />
  )
}

/** Keyboard layer over the plot: one tab stop, arrows/Home/End move, Enter follows the link. */
function PointLinks({
  data,
  getPointHref,
  ariaLabel,
  formatValue,
  actionLabel,
}: {
  data: readonly TimeSeriesPoint[]
  getPointHref: (point: TimeSeriesPoint, index: number) => string
  ariaLabel: string
  formatValue?: (n: number) => string
  actionLabel: string
}) {
  const [active, setActive] = useState(data.length - 1)
  const refs = useRef<(HTMLAnchorElement | null)[]>([])
  const n = data.length
  const current = Math.min(Math.max(active, 0), n - 1)

  function move(to: number) {
    const next = Math.min(Math.max(to, 0), n - 1)
    setActive(next)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="group"
      aria-label={`${ariaLabel}: select a period`}
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{ bottom: AXIS_HEIGHT }}
    >
      {data.map((p, i) => {
        // Points sit on a "point" scale: first at 0%, last at 100%.
        const step = n > 1 ? 100 / (n - 1) : 100
        const center = n > 1 ? i * step : 50
        const width = n > 1 ? step : 100
        const left = Math.max(0, center - width / 2)
        const right = Math.min(100, center + width / 2)
        return (
          <Link
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            to={getPointHref(p, i)}
            tabIndex={i === current ? 0 : -1}
            onFocus={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(i + 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(i - 1)
              } else if (e.key === 'Home') {
                e.preventDefault()
                move(0)
              } else if (e.key === 'End') {
                e.preventDefault()
                move(n - 1)
              }
            }}
            className="absolute inset-y-0 rounded focus:outline-none focus-visible:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent"
            style={{ left: `${left}%`, width: `${right - left}%` }}
          >
            <span className="sr-only">
              {`${p.tooltipLabel ?? p.label}: ${fmt(p.value, formatValue)}, ${actionLabel}`}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function NavigableChart(props: TimeSeriesChartProps & { getPointHref: NonNullable<TimeSeriesChartProps['getPointHref']> }) {
  const navigate = useNavigate()
  const { data, getPointHref } = props
  return (
    <ChartBody
      {...props}
      onPointClick={(i) => {
        const p = data[i]
        if (p != null) navigate(getPointHref(p, i))
      }}
      overlay={
        data.length > 0 ? (
          <PointLinks
            data={data}
            getPointHref={getPointHref}
            ariaLabel={props.ariaLabel}
            formatValue={props.formatValue}
            actionLabel={props.pointActionLabel ?? 'view details'}
          />
        ) : null
      }
    />
  )
}

function ChartBody({
  data,
  ariaLabel,
  height = 220,
  color = chartColor(0),
  formatValue,
  seriesLabel = 'This period',
  previousLabel = 'Previous period',
  showPrevious = false,
  referenceLine,
  onPointClick,
  overlay,
}: TimeSeriesChartProps & { onPointClick?: (index: number) => void; overlay?: ReactNode }) {
  const gradientId = `ts-gradient-${useId().replace(/[^a-z0-9]/gi, '')}`
  const chartData = data.map((d, index) => ({ ...d, index }))
  const maxValue = Math.max(
    0,
    ...data.map((d) => d.value ?? 0),
    ...(showPrevious ? data.map((d) => d.previous ?? 0) : []),
    referenceLine?.value ?? 0,
  )
  const showLegend = showPrevious || referenceLine != null

  return (
    <div>
      {showLegend && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <LegendSwatch kind="solid" color={color} />
            {seriesLabel}
          </span>
          {showPrevious && (
            <span className="inline-flex items-center gap-1.5">
              <LegendSwatch kind="dashed" color={PREVIOUS_COLOR} />
              {previousLabel}
            </span>
          )}
          {referenceLine != null && (
            <span className="inline-flex items-center gap-1.5">
              <LegendSwatch kind="dotted" color={REFERENCE_COLOR} />
              {referenceLine.label}
            </span>
          )}
        </div>
      )}
      <div
        className={cn('relative', onPointClick != null && '[&_.recharts-surface]:cursor-pointer')}
        role="figure"
        aria-label={ariaLabel}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
            onClick={
              onPointClick
                ? (state) => {
                    const idx = Number(state?.activeTooltipIndex)
                    if (Number.isInteger(idx) && idx >= 0) onPointClick(idx)
                  }
                : undefined
            }
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_CHROME.grid} vertical={false} />
            <XAxis
              dataKey="label"
              height={AXIS_HEIGHT}
              tick={{ fill: CHART_CHROME.tick, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis hide domain={[0, maxValue > 0 ? maxValue * 1.08 : 1]} />
            <Tooltip
              content={(p) =>
                renderTooltip(p, data, { formatValue, seriesLabel, previousLabel, showPrevious, color })
              }
              cursor={{ stroke: CHART_CHROME.cursor, strokeWidth: 1 }}
            />
            {referenceLine != null && (
              <ReferenceLine
                y={referenceLine.value}
                stroke={REFERENCE_COLOR}
                strokeDasharray="2 4"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              name={seriesLabel}
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: color, stroke: CHART_CHROME.surface, strokeWidth: 2 }}
            />
            {showPrevious && (
              <Line
                type="monotone"
                dataKey="previous"
                name={previousLabel}
                stroke={PREVIOUS_COLOR}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 3, fill: PREVIOUS_COLOR, stroke: CHART_CHROME.surface, strokeWidth: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {overlay}
      </div>
    </div>
  )
}

/**
 * Time-series area chart with an optional dashed previous-period overlay, a reference
 * line (e.g. budget) and per-bucket drill-down links. One y-axis only.
 */
export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const { getPointHref } = props
  if (getPointHref != null) return <NavigableChart {...props} getPointHref={getPointHref} />
  return <ChartBody {...props} />
}
