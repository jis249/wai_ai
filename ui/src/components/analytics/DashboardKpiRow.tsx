import type React from 'react'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { Activity, CircleX, Coins, DollarSign, Timer, Zap } from '../ui/icons'
import { useDashboardKpis } from '../../hooks/useDashboardKpis'
import type { TimeRangeValue } from '../../lib/timeRange'
import { KpiCard } from './KpiCard'
import { buildKpiSpecs, type KpiSpec } from './kpiSpecs'

const ICON = 'h-4 w-4'

const ICONS: Record<KpiSpec['id'], React.ReactNode> = {
  requests: <Activity className={ICON} />,
  error_rate: <CircleX className={ICON} />,
  latency_p95: <Timer className={ICON} />,
  cache_hit_rate: <Zap className={ICON} />,
  cost: <DollarSign className={ICON} />,
  tokens: <Coins className={ICON} />,
}

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'

export interface DashboardKpiRowProps {
  range: TimeRangeValue
  from: string
  to: string
  enabled?: boolean
}

/** Six KPI tiles for the selected range, each linking into the request log. */
export function DashboardKpiRow({ range, from, to, enabled = true }: DashboardKpiRowProps) {
  const query = useDashboardKpis(from, to, enabled)

  if (query.isError && query.data == null) {
    return (
      <ErrorState
        variant="card"
        title="Couldn't load KPIs"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  if (query.data == null) {
    return (
      <div className={GRID} aria-busy="true" aria-label="Loading KPIs">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[148px] rounded-xl" />
        ))}
      </div>
    )
  }

  const specs = buildKpiSpecs(query.data, range)
  return (
    <section aria-label="Key metrics">
      <ul className={GRID}>
        {specs.map((s) => (
          <li key={s.id} className="min-w-0">
            <KpiCard
              label={s.label}
              value={s.value}
              icon={ICONS[s.id]}
              delta={s.delta}
              trend={s.trend}
              trendSummary={s.trendSummary}
              trendColor={s.color}
              href={s.href}
              linkHint={s.linkHint}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
