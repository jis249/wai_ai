import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowUp } from '../ui/icons'
import { Sparkline } from '../ui/Sparkline'
import { cn } from '../../lib/utils'
import { kpiToneClass, type KpiDelta } from './kpi'

export interface KpiCardProps {
  label: string
  value: string
  icon?: React.ReactNode
  /** Change vs the previous period; omit to hide the delta row. */
  delta?: KpiDelta
  /** Sparkline values (oldest first); omit or pass [] for none. */
  trend?: readonly number[]
  /** Screen-reader description of the trend (the sparkline itself is aria-hidden). */
  trendSummary?: string
  trendColor?: string
  /** Drill-down target; renders the whole card as a link. */
  href?: string
  /** Appended to the link's accessible name, e.g. "View errors in request logs". */
  linkHint?: string
  className?: string
}

function DeltaArrow({ direction }: { direction: KpiDelta['direction'] }) {
  const cls = 'h-3.5 w-3.5 shrink-0'
  if (direction === 'up') return <ArrowUp className={cls} aria-hidden="true" />
  if (direction === 'down') return <ArrowDown className={cls} aria-hidden="true" />
  return <ArrowRight className={cls} aria-hidden="true" />
}

/** KPI tile: value, delta vs previous period (arrow + text + tone), sparkline, optional drill-down link. */
export function KpiCard({
  label,
  value,
  icon,
  delta,
  trend,
  trendSummary,
  trendColor,
  href,
  linkHint,
  className,
}: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-text-tertiary">{label}</span>
        {icon != null && (
          <span className="shrink-0 text-text-tertiary" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
      {delta != null && (
        <div data-slot="delta" data-tone={delta.tone} className={cn('mt-1 flex items-center gap-1 text-xs', kpiToneClass(delta.tone))}>
          <DeltaArrow direction={delta.direction} />
          <span aria-hidden="true" className="font-medium tabular-nums">
            {delta.label}
          </span>
          <span aria-hidden="true" className="text-text-tertiary">
            vs prev.
          </span>
          <span className="sr-only">{delta.srText}</span>
        </div>
      )}
      <div className="mt-3 h-8">
        {trend != null && trend.length > 0 && <Sparkline values={trend} color={trendColor} height={32} />}
      </div>
      {trendSummary != null && <span className="sr-only">{trendSummary}</span>}
      {href != null && linkHint != null && <span className="sr-only">{linkHint}</span>}
    </>
  )

  const base = 'relative block min-w-0 rounded-xl border border-border bg-bg-secondary p-5'
  if (href != null) {
    return (
      <Link
        to={href}
        className={cn(
          base,
          'no-underline transition-colors hover:border-accent/40 hover:bg-bg-tertiary/30',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          className,
        )}
      >
        {body}
      </Link>
    )
  }
  return (
    <div role="group" aria-label={label} className={cn(base, className)}>
      {body}
    </div>
  )
}
