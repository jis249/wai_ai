import { useCallback, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { ErrorState } from '../components/ui/ErrorState'
import { EmptyState } from '../components/ui/EmptyState'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { TimeRangePicker } from '../components/ui/TimeRangePicker'
import { Cpu, DollarSign, Info, Receipt, TrendingDown } from '../components/ui/icons'
import { Toggle } from '../components/ui/Toggle'
import { TimeSeriesChart } from '../components/ui/charts/TimeSeriesChart'
import { ChartSection } from '../components/analytics/ChartSection'
import { ExportButtons } from '../components/analytics/ExportButtons'
import { SpendBudgetCard } from '../components/analytics/SpendBudgetCard'
import { StatCardSkeletons } from '../components/analytics/StatCardSkeletons'
import { buildCompareSeries } from '../components/analytics/compareSeries'
import { previousWindow } from '../components/analytics/timeSeries'
import { useMe } from '../hooks/useMe'
import { useUsage, useMyUsage } from '../hooks/useUsage'
import type { UsageDataPoint } from '../hooks/useUsage'
import { formatNumber, formatReportCost, type CostCurrency } from '../lib/utils'
import { COST_CURRENCY_STORAGE_KEY, USD_TO_INR_RATE } from '../lib/constants'
import { COST_TIME_RANGE_PRESETS, useTimeRange, type TimeRangeValue } from '../lib/timeRange'

const COST_MODEL_HEADERS = [
  { key: 'group_key', label: 'Model' },
  { key: 'cost_estimate', label: 'Total Cost' },
  { key: 'pct', label: '% of Total' },
  { key: 'total_requests', label: 'Requests' },
  { key: 'avg_cost_per_request', label: 'Avg Cost / Request' },
]

const CURRENCY_OPTIONS: { value: CostCurrency; label: string; ariaLabel: string }[] = [
  { value: 'USD', label: '$ USD', ariaLabel: 'US dollars' },
  { value: 'INR', label: '₹ INR (approx.)', ariaLabel: `Indian rupees, approximate at a fixed ${USD_TO_INR_RATE} INR per USD` },
]

const DEFAULT_AZURE_PRICING = {
  inputPer1M: 1.75,
  outputPer1M: 14.00,
}

const MODEL_PRICING: Record<string, typeof DEFAULT_AZURE_PRICING> = {
  'gpt-5.3-codex': { inputPer1M: 1.75, outputPer1M: 14.00 },
  'gpt-6-astra': { inputPer1M: 10.00, outputPer1M: 50.00 },
}

function estimateCostFromTokens(
  usage: Pick<UsageDataPoint, 'prompt_tokens' | 'completion_tokens'>,
  pricing: typeof DEFAULT_AZURE_PRICING,
): number {
  return (usage.prompt_tokens / 1_000_000) * pricing.inputPer1M +
    (usage.completion_tokens / 1_000_000) * pricing.outputPer1M
}

function costForModelUsage(usage: UsageDataPoint): number {
  if (usage.cost_estimate > 0) return usage.cost_estimate
  const pricing = MODEL_PRICING[usage.group_key]
  return pricing ? estimateCostFromTokens(usage, pricing) : 0
}

function costForDailyUsage(usage: UsageDataPoint): number {
  return usage.cost_estimate > 0
    ? usage.cost_estimate
    : estimateCostFromTokens(usage, DEFAULT_AZURE_PRICING)
}

function readStoredCurrency(): CostCurrency {
  const stored = localStorage.getItem(COST_CURRENCY_STORAGE_KEY)
  return stored === 'INR' ? 'INR' : 'USD'
}

// ---------------------------------------------------------------------------
// Cost by Model table
// ---------------------------------------------------------------------------

interface ModelCostRow extends UsageDataPoint {
  pct: number
  avg_cost_per_request: number
}

function buildModelColumns(formatCost: (amountUsd: number) => string): Column<ModelCostRow>[] {
  return [
    {
      key: 'group_key',
      header: 'Model',
      render: (row) => (
        <span className="font-mono text-text-primary">{row.group_key}</span>
      ),
    },
    {
      key: 'cost_estimate',
      header: 'Total Cost',
      align: 'right',
      render: (row) => (
        <span className="text-text-primary font-medium">{formatCost(row.cost_estimate)}</span>
      ),
    },
    {
      key: 'pct',
      header: '% of Total',
      align: 'right',
      render: (row) => (
        <span className="text-text-secondary">{row.pct.toFixed(1)}%</span>
      ),
    },
    {
      key: 'total_requests',
      header: 'Requests',
      align: 'right',
      render: (row) => (
        <span className="text-text-secondary">{formatNumber(row.total_requests)}</span>
      ),
    },
    {
      key: 'avg_cost_per_request',
      header: 'Avg Cost / Request',
      align: 'right',
      render: (row) => (
        <span className="text-text-tertiary">
          {row.total_requests > 0
            ? formatCost(row.cost_estimate / row.total_requests)
            : formatCost(0)}
        </span>
      ),
    },
  ]
}

// ---------------------------------------------------------------------------
// Daily Cost Trend table
// ---------------------------------------------------------------------------

interface DayCostRow extends UsageDataPoint {
  change_pct: number | null
}

const dayColumns = (formatCost: (amountUsd: number) => string): Column<DayCostRow>[] => [
  {
    key: 'group_key',
    header: 'Date',
    render: (row) => (
      <span className="font-mono text-text-primary">{row.group_key}</span>
    ),
  },
  {
    key: 'cost_estimate',
    header: 'Cost',
    align: 'right',
    render: (row) => (
      <span className="text-text-primary font-medium">{formatCost(row.cost_estimate)}</span>
    ),
  },
  {
    key: 'total_requests',
    header: 'Requests',
    align: 'right',
    render: (row) => (
      <span className="text-text-secondary">{formatNumber(row.total_requests)}</span>
    ),
  },
  {
    key: 'avg_cost_per_request',
    header: 'Avg Cost / Request',
    align: 'right',
    render: (row) => (
      <span className="text-text-tertiary">
        {row.total_requests > 0
          ? formatCost(row.cost_estimate / row.total_requests)
          : formatCost(0)}
      </span>
    ),
  },
  {
    key: 'change_pct',
    header: 'vs Prior Day',
    align: 'right',
    render: (row) => {
      if (row.change_pct === null) {
        return <span className="text-text-tertiary">—</span>
      }
      const isPositive = row.change_pct > 0
      const isNeutral = row.change_pct === 0
      const colorClass = isNeutral
        ? 'text-text-tertiary'
        : isPositive
          ? 'text-error'
          : 'text-success'
      const arrow = isNeutral ? '' : isPositive ? '▲ ' : '▼ '
      const direction = isNeutral ? 'No change' : isPositive ? 'Up' : 'Down'
      return (
        <span className={colorClass}>
          <span aria-hidden="true">{arrow}</span>
          <span className="sr-only">{direction} </span>
          {Math.abs(row.change_pct).toFixed(1)}%
        </span>
      )
    },
  },
]

// ---------------------------------------------------------------------------
// CostReportsPage
// ---------------------------------------------------------------------------

export default function CostReportsPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const [range, setRange] = useState<TimeRangeValue>('30d')
  const [currency, setCurrency] = useState<CostCurrency>(readStoredCurrency)
  const [compare, setCompare] = useState(false)
  const { data: me } = useMe()
  const orgId = me?.org_id ?? ''
  const canViewOrgUsage = me?.is_system_admin === true || me?.role === 'org_admin'

  const { from, to, hours, preset } = useTimeRange(range)

  const orgModelUsage = useUsage(orgId, from, to, 'model', !!me && canViewOrgUsage)
  const myModelUsage = useMyUsage(from, to, 'model', !!me && !canViewOrgUsage)
  const orgDayUsage = useUsage(orgId, from, to, 'day', !!me && canViewOrgUsage)
  const myDayUsage = useMyUsage(from, to, 'day', !!me && !canViewOrgUsage)
  const modelQuery = canViewOrgUsage ? orgModelUsage : myModelUsage
  const dayQuery = canViewOrgUsage ? orgDayUsage : myDayUsage
  const { data: modelUsage, isLoading: modelLoading } = modelQuery
  const { data: dayUsage, isLoading: dayLoading } = dayQuery

  // Previous window (same length, just before `from`) for the dashed comparison series.
  const prev = useMemo(() => previousWindow(from, to), [from, to])
  const orgPrevDay = useUsage(orgId, prev.from, prev.to, 'day', !!me && canViewOrgUsage && compare)
  const myPrevDay = useMyUsage(prev.from, prev.to, 'day', !!me && !canViewOrgUsage && compare)
  const prevDayData = (canViewOrgUsage ? orgPrevDay : myPrevDay).data?.data

  const dayPoints = useMemo(
    () =>
      buildCompareSeries({
        from,
        to,
        granularity: 'day',
        current: (dayUsage?.data ?? []).map((d) => ({ key: d.group_key, value: costForDailyUsage(d) })),
        previous:
          compare && prevDayData != null
            ? prevDayData.map((d) => ({ key: d.group_key, value: costForDailyUsage(d) }))
            : null,
      }),
    [from, to, dayUsage, compare, prevDayData],
  )

  // Compute totals and model rows
  const { totalCost, modelRows, avgCostPerDay, topModel } = useMemo(() => {
    const data = modelUsage?.data ?? []
    const total = data.reduce((acc, d) => acc + costForModelUsage(d), 0)
    const days = hours / 24
    const avg = days > 0 ? total / days : 0
    const sorted = [...data].sort((a, b) => costForModelUsage(b) - costForModelUsage(a))
    const rows: ModelCostRow[] = sorted.map((d) => {
      const cost = costForModelUsage(d)
      return {
        ...d,
        cost_estimate: cost,
        pct: total > 0 ? (cost / total) * 100 : 0,
        avg_cost_per_request:
          d.total_requests > 0 ? cost / d.total_requests : 0,
      }
    })
    const top = sorted[0]?.group_key ?? '—'
    return { totalCost: total, modelRows: rows, avgCostPerDay: avg, topModel: top }
  }, [modelUsage, hours])

  // Compute day rows with change vs prior day
  const dayRows: DayCostRow[] = useMemo(() => {
    const data = dayUsage?.data ?? []
    const sorted = [...data].sort((a, b) => a.group_key.localeCompare(b.group_key))
    return sorted.map((d, i) => {
      const cost = costForDailyUsage(d)
      const prior = i > 0 ? costForDailyUsage(sorted[i - 1]) : null
      let change_pct: number | null = null
      if (prior !== null && prior > 0) {
        change_pct = ((cost - prior) / prior) * 100
      } else if (prior === 0 && cost > 0) {
        change_pct = 100
      } else if (prior !== null) {
        change_pct = 0
      }
      return { ...d, cost_estimate: cost, change_pct }
    })
  }, [dayUsage])

  const dayRowsDesc = useMemo(() => [...dayRows].reverse(), [dayRows])

  const formatCost = useCallback(
    (amountUsd: number) => formatReportCost(amountUsd, currency),
    [currency],
  )
  const modelColumns = useMemo(() => buildModelColumns(formatCost), [formatCost])
  const dailyColumns = useMemo(() => dayColumns(formatCost), [formatCost])

  const exportHeaders = useMemo(
    () =>
      COST_MODEL_HEADERS.map((header) =>
        header.key === 'cost_estimate' || header.key === 'avg_cost_per_request'
          ? { ...header, label: `${header.label} (${currency})` }
          : header,
      ),
    [currency],
  )

  const exportRows = useMemo(
    () =>
      modelRows.map((row) => ({
        ...row,
        cost_estimate: formatCost(row.cost_estimate),
        avg_cost_per_request:
          row.total_requests > 0
            ? formatCost(row.cost_estimate / row.total_requests)
            : formatCost(0),
      })),
    [modelRows, formatCost],
  )

  const handleCurrencyChange = (next: CostCurrency) => {
    setCurrency(next)
    localStorage.setItem(COST_CURRENCY_STORAGE_KEY, next)
  }

  const isModelLoading = modelLoading && !!me && (canViewOrgUsage ? !!orgId : true)
  const isDayLoading = dayLoading && !!me && (canViewOrgUsage ? !!orgId : true)

  const rangeSlug = preset ?? 'custom'
  const noCost = (description: string) => (
    <EmptyState icon={<Receipt className="w-6 h-6" />} title="No cost data" description={description} className="py-8" />
  )

  return (
    <div className="min-w-0">
      {!hideHeader && (
        <PageHeader
          title="Cost Reports"
          description="Cloud-model cost estimates. Local/Ollama traffic is usually $0 — use token budgets on the dashboard as the primary cap."
        />
      )}

      {/* Time range + currency + export */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <TimeRangePicker value={range} onChange={setRange} presets={COST_TIME_RANGE_PRESETS} labelStyle="medium" />
        <SegmentedControl<CostCurrency>
          aria-label="Currency"
          options={CURRENCY_OPTIONS}
          value={currency}
          onChange={handleCurrencyChange}
        />
        <div className="sm:ml-auto">
          <ExportButtons
            data={exportRows}
            headers={exportHeaders}
            filenamePrefix={`wai-cost-by-model-${rangeSlug}`}
            subject="cost by model"
          />
        </div>
      </div>
      <p className="mb-6 flex items-start gap-1.5 text-xs text-text-tertiary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Costs are recorded in USD. INR amounts are approximate, converted at a fixed rate of {USD_TO_INR_RATE} INR per
          1 USD (not a live exchange rate).
        </span>
      </p>

      {modelQuery.isError && modelUsage == null ? (
        <ErrorState
          variant="card"
          className="mb-8"
          title="Couldn't load cost by model"
          error={modelQuery.error}
          onRetry={() => void modelQuery.refetch()}
          retrying={modelQuery.isFetching}
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {isModelLoading ? (
              <StatCardSkeletons count={3} />
            ) : (
              <>
                <StatCard label="Total Cost" value={formatCost(totalCost)} icon={<DollarSign className="w-4 h-4" />} iconColor="purple" />
                <StatCard label="Avg Cost / Day" value={formatCost(avgCostPerDay)} icon={<TrendingDown className="w-4 h-4" />} iconColor="blue" />
                <StatCard
                  label="Top Model by Cost"
                  value={topModel}
                  icon={<Cpu className="w-4 h-4" />}
                  iconColor="yellow"
                  className="min-w-0 break-words"
                />
              </>
            )}
          </div>

          {canViewOrgUsage && orgId !== '' && <SpendBudgetCard orgId={orgId} formatCost={formatCost} className="mb-8" />}

          {/* Cost by Model */}
          <section className="mb-8" aria-labelledby="cost-by-model">
            <h2 id="cost-by-model" className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Cost by Model
            </h2>
            <Table<ModelCostRow>
              columns={modelColumns}
              data={modelRows}
              keyExtractor={(row) => row.group_key}
              loading={isModelLoading}
              emptyState={noCost('No model costs were recorded in the selected time range.')}
            />
          </section>
        </>
      )}

      {/* Daily Cost Trend */}
      <section aria-labelledby="cost-daily">
        <h2 id="cost-daily" className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Daily Cost Trend
        </h2>
        {dayQuery.isError && dayUsage == null ? (
          <ErrorState
            variant="card"
            title="Couldn't load daily costs"
            error={dayQuery.error}
            onRetry={() => void dayQuery.refetch()}
            retrying={dayQuery.isFetching}
          />
        ) : (
          <div className="space-y-4">
            <ChartSection
              title="Cost per day"
              description="Estimated cost per UTC day."
              query={dayQuery}
              loading={isDayLoading}
              isEmpty={dayRows.length === 0 && !(compare && (prevDayData ?? []).length > 0)}
              emptyTitle="No cost data"
              emptyDescription="No daily costs were recorded in the selected time range."
              errorTitle="Couldn't load daily costs"
              actions={
                <Toggle
                  checked={compare}
                  onChange={setCompare}
                  size="sm"
                  label="Compare to previous period"
                  aria-label="Compare to previous period"
                />
              }
            >
              <TimeSeriesChart
                ariaLabel="Estimated cost per day"
                data={dayPoints}
                height={220}
                formatValue={formatCost}
                seriesLabel="This period"
                previousLabel="Previous period"
                showPrevious={compare}
              />
            </ChartSection>
            <Table<DayCostRow>
              columns={dailyColumns}
              data={dayRowsDesc}
              keyExtractor={(row) => row.group_key}
              loading={isDayLoading}
              emptyState={noCost('No daily costs were recorded in the selected time range.')}
            />
          </div>
        )}
      </section>
    </div>
  )
}
