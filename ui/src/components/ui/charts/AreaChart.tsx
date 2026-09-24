import { useId } from 'react'
import {
  ResponsiveContainer,
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent'
import { CHART_CHROME, chartColor } from '../../../lib/chartColors'

export interface AreaChartProps {
  data: { label: string; value: number }[]
  height?: number
  /** Series color. Any CSS color or `var(--chart-N)`; defaults to the first chart token. */
  color?: string
  showGrid?: boolean
  formatValue?: (n: number) => string
}

function renderTooltip(
  props: TooltipContentProps<ValueType, NameType>,
  formatValue: ((n: number) => string) | undefined,
  colors: { bg: string; border: string; label: string; value: string },
) {
  const { active, payload, label } = props
  if (!active || !payload || payload.length === 0) return null
  const raw = payload[0]?.value
  const numVal = typeof raw === 'number' ? raw : 0
  const display = formatValue ? formatValue(numVal) : numVal.toLocaleString()
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '8px 12px',
      }}
    >
      <p style={{ color: colors.label, fontSize: 11, marginBottom: 2 }}>{label}</p>
      <p style={{ color: colors.value, fontSize: 14, fontWeight: 600 }}>{display}</p>
    </div>
  )
}

const GRADIENT_ID_PREFIX = 'area-chart-gradient-'

export function AreaChart({
  data,
  height = 300,
  color = chartColor(0),
  showGrid = false,
  formatValue,
}: AreaChartProps) {
  const instanceId = useId()
  const chartColors = {
    tick: CHART_CHROME.tick,
    grid: CHART_CHROME.grid,
    cursor: CHART_CHROME.cursor,
    dotStroke: CHART_CHROME.surface,
    tooltip: CHART_CHROME.tooltip,
  }

  // Unique per instance so multiple charts on the same page can coexist
  const gradientId = `${GRADIENT_ID_PREFIX}${instanceId.replace(/[^a-z0-9]/gi, '')}`

  const chartData = data.map((d) => ({ label: d.label, value: d.value }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {showGrid && (
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={chartColors.grid}
            vertical={false}
          />
        )}

        <XAxis
          dataKey="label"
          tick={{ fill: chartColors.tick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />

        <YAxis hide />

        <Tooltip
          content={(tooltipProps) => renderTooltip(tooltipProps, formatValue, chartColors.tooltip)}
          cursor={{ stroke: chartColors.cursor, strokeWidth: 1 }}
        />

        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: chartColors.dotStroke, strokeWidth: 2 }}
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  )
}
