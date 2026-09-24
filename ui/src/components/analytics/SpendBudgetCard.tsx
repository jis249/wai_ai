import { useMemo, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { TimeSeriesChart } from '../ui/charts/TimeSeriesChart'
import { useOrg } from '../../hooks/useOrg'
import { useUsage } from '../../hooks/useUsage'
import { chartColor } from '../../lib/chartColors'
import { cn } from '../../lib/utils'
import { cumulativeMonthSeries, currentUtcMonth } from './budget'

export interface SpendBudgetCardProps {
  orgId: string
  /** Currency-aware formatter for USD amounts. */
  formatCost: (usd: number) => string
  className?: string
}

/**
 * Month-to-date spend against the org's `monthly_spend_limit` (hidden when no limit is set):
 * % used, a progress bar, and cumulative spend with a budget reference line.
 */
export function SpendBudgetCard({ orgId, formatCost, className }: SpendBudgetCardProps) {
  const { data: org } = useOrg(orgId)
  const limit = org?.monthly_spend_limit ?? 0
  const [month] = useState(() => currentUtcMonth())
  const mtd = useUsage(orgId, month.start, month.now, 'day', limit > 0)

  const { spent, series } = useMemo(() => {
    const days = (mtd.data?.data ?? []).map((d) => ({ key: d.group_key, cost: d.cost_estimate }))
    return {
      spent: days.reduce((acc, d) => acc + (Number.isFinite(d.cost) ? d.cost : 0), 0),
      series: cumulativeMonthSeries(month, days),
    }
  }, [mtd.data, month])

  if (!(limit > 0)) return null

  const pct = (spent / limit) * 100
  const barPct = Math.min(pct, 100)
  const tone = pct >= 90 ? 'bg-error' : pct >= 70 ? 'bg-warning' : 'bg-accent'
  const monthName = new Date(month.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <Card className={cn('min-w-0', className)} as="section" aria-labelledby="spend-budget-title">
      <CardHeader
        title={<span id="spend-budget-title">Monthly spend budget</span>}
        description={`${monthName} (UTC), month to date. Requests are blocked once the limit is reached.`}
        className="flex-wrap"
      />
      {mtd.isError && mtd.data == null ? (
        <ErrorState
          title="Couldn't load this month's spend"
          error={mtd.error}
          onRetry={() => void mtd.refetch()}
          retrying={mtd.isFetching}
          className="py-8"
        />
      ) : mtd.isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-2xl font-semibold tabular-nums text-text-primary">
                {pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%{' '}
                <span className="text-sm font-normal text-text-secondary">of budget used</span>
              </p>
              <p className="text-sm tabular-nums text-text-secondary">
                {formatCost(spent)} of {formatCost(limit)}
              </p>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-bg-tertiary"
              role="progressbar"
              aria-label="Monthly spend budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(barPct)}
              aria-valuetext={`${Math.round(pct)}% used: ${formatCost(spent)} of ${formatCost(limit)}`}
            >
              <div className={cn('h-full rounded-full', tone)} style={{ width: `${barPct}%` }} />
            </div>
          </div>
          <TimeSeriesChart
            ariaLabel="Cumulative spend this month against the budget"
            data={series}
            height={200}
            color={chartColor(0)}
            formatValue={formatCost}
            seriesLabel="Spend to date"
            referenceLine={{ value: limit, label: `Budget ${formatCost(limit)}` }}
          />
        </div>
      )}
    </Card>
  )
}
