import { useMemo, useState } from 'react'
import { StatCard } from '../../components/ui/StatCard'
import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { Select } from '../../components/ui/Select'
import { Card, CardHeader } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { TimeRangePicker } from '../../components/ui/TimeRangePicker'
import { Activity, ChartColumn, DollarSign, Sparkles } from '../../components/ui/icons'
import { DonutChart, HorizontalBar, TimeSeriesChart } from '../../components/ui/charts'
import { Toggle } from '../../components/ui/Toggle'
import { ExportButtons } from '../../components/analytics/ExportButtons'
import { buildCompareSeries } from '../../components/analytics/compareSeries'
import { bucketRange, requestLogsUrl } from '../../components/analytics/drilldown'
import { previousWindow } from '../../components/analytics/timeSeries'
import { UsageScopeToggle } from '../../components/analytics/UsageScopeToggle'
import { useMe } from '../../hooks/useMe'
import { useUsage, useMyUsage, useCrossOrgUsage } from '../../hooks/useUsage'
import type { UsageDataPoint } from '../../hooks/useUsage'
import { formatNumber, formatTokens, formatCost } from '../../lib/utils'
import { chartColor } from '../../lib/chartColors'
import { useTimeRange, type TimeGranularity, type TimeRangeValue } from '../../lib/timeRange'

const BASE_GROUP_BY_OPTIONS = [
  { value: 'model', label: 'Model' },
  { value: 'team', label: 'Team' },
  { value: 'user', label: 'User' },
  { value: 'key', label: 'Key' },
  { value: 'day', label: 'Day' },
  { value: 'hour', label: 'Hour' },
]

const CROSS_ORG_GROUP_BY_OPTIONS = [
  ...BASE_GROUP_BY_OPTIONS,
  { value: 'org', label: 'Org' },
]

const GROUP_BY_HEADERS: Record<string, string> = {
  model: 'Model',
  team: 'Team',
  user: 'User',
  key: 'Key',
  day: 'Date',
  hour: 'Hour',
  org: 'Org',
}

function groupDisplayValue(row: UsageDataPoint): string {
  return row.group_label || row.group_key
}

function buildColumns(groupBy: string): Column<UsageDataPoint>[] {
  return [
    {
      key: 'group_key',
      header: GROUP_BY_HEADERS[groupBy] ?? 'Group',
      render: (row) => (
        <span className={row.group_label ? 'text-text-primary' : 'font-mono text-text-primary'}>
          {groupDisplayValue(row)}
        </span>
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
      key: 'prompt_tokens',
      header: 'Prompt Tokens',
      align: 'right',
      render: (row) => (
        <span className="text-text-secondary">{formatTokens(row.prompt_tokens)}</span>
      ),
    },
    {
      key: 'completion_tokens',
      header: 'Completion Tokens',
      align: 'right',
      render: (row) => (
        <span className="text-text-secondary">{formatTokens(row.completion_tokens)}</span>
      ),
    },
    {
      key: 'total_tokens',
      header: 'Total Tokens',
      align: 'right',
      render: (row) => (
        <span className="text-text-primary font-medium">{formatTokens(row.total_tokens)}</span>
      ),
    },
    {
      key: 'cost_estimate',
      header: 'Cost',
      align: 'right',
      render: (row) => (
        <span className="text-text-secondary">{formatCost(row.cost_estimate)}</span>
      ),
    },
    {
      key: 'avg_duration_ms',
      header: 'Avg Duration',
      align: 'right',
      render: (row) => (
        <span className="text-text-tertiary">{formatNumber(Math.round(row.avg_duration_ms))} ms</span>
      ),
    },
  ]
}

const USAGE_EXPORT_HEADERS = [
  { key: 'group_key', label: 'Group' },
  { key: 'total_requests', label: 'Requests' },
  { key: 'prompt_tokens', label: 'Prompt Tokens' },
  { key: 'completion_tokens', label: 'Completion Tokens' },
  { key: 'total_tokens', label: 'Total Tokens' },
  { key: 'cost_estimate', label: 'Cost' },
  { key: 'avg_duration_ms', label: 'Avg Duration (ms)' },
]

// ---------------------------------------------------------------------------
// LLMUsagePage
// ---------------------------------------------------------------------------

export default function LLMUsagePage() {
  const [range, setRange] = useState<TimeRangeValue>('24h')
  const [groupBy, setGroupBy] = useState('model')
  const [crossOrg, setCrossOrg] = useState(false)
  const [compare, setCompare] = useState(false)

  const { data: me } = useMe()
  const orgId = me?.org_id ?? ''
  const isSystemAdmin = me?.is_system_admin === true
  const canViewOrgUsage = isSystemAdmin || me?.role === 'org_admin'

  const { from, to, granularity } = useTimeRange(range)
  const prev = useMemo(() => previousWindow(from, to), [from, to])

  const orgUsage = useUsage(orgId, from, to, groupBy, !!me && canViewOrgUsage)
  const myUsage = useMyUsage(from, to, groupBy, !!me && !canViewOrgUsage)
  const crossOrgUsage = useCrossOrgData({ from, to, groupBy, enabled: isSystemAdmin })

  const activeResult = crossOrg && isSystemAdmin
    ? crossOrgUsage
    : canViewOrgUsage
      ? orgUsage
      : myUsage

  const { data: usage, isLoading } = activeResult

  // Trend buckets: the table's own day/hour grouping, else hourly for <=48h and daily beyond.
  // Not shown cross-org.
  const trendGroup: TimeGranularity = groupBy === 'day' || groupBy === 'hour' ? groupBy : granularity
  const needsSeparateTrend = !crossOrg && groupBy !== trendGroup
  const orgTrendUsage = useUsage(orgId, from, to, trendGroup, !!me && canViewOrgUsage && needsSeparateTrend)
  const myTrendUsage = useMyUsage(from, to, trendGroup, !!me && !canViewOrgUsage && needsSeparateTrend)
  const separateTrend = canViewOrgUsage ? orgTrendUsage : myTrendUsage
  const trendQuery = needsSeparateTrend ? separateTrend : activeResult
  // Use main data directly when groupBy is already the trend bucket
  const trendData = needsSeparateTrend ? separateTrend.data?.data : usage?.data

  // Previous window (same length, just before `from`) for the dashed comparison series.
  const wantPrevious = compare && !crossOrg && !!me
  const orgPrevUsage = useUsage(orgId, prev.from, prev.to, trendGroup, wantPrevious && canViewOrgUsage)
  const myPrevUsage = useMyUsage(prev.from, prev.to, trendGroup, wantPrevious && !canViewOrgUsage)
  const prevData = (canViewOrgUsage ? orgPrevUsage : myPrevUsage).data?.data

  const trendPoints = useMemo(
    () =>
      buildCompareSeries({
        from,
        to,
        granularity: trendGroup,
        current: (trendData ?? []).map((d) => ({ key: d.group_key, value: d.total_requests })),
        previous:
          compare && prevData != null
            ? prevData.map((d) => ({ key: d.group_key, value: d.total_requests }))
            : null,
      }),
    [from, to, trendGroup, trendData, compare, prevData],
  )

  // When switching away from cross-org, reset group_by if it was set to 'org'
  const handleCrossOrgToggle = (next: boolean) => {
    if (next) {
      setGroupBy('org')
    } else if (groupBy === 'org') {
      setGroupBy('model')
    }
    setCrossOrg(next)
  }

  const groupByOptions = crossOrg && isSystemAdmin
    ? CROSS_ORG_GROUP_BY_OPTIONS
    : BASE_GROUP_BY_OPTIONS

  const totals = useMemo(() => {
    if (!usage?.data) return { requests: 0, tokens: 0, cost: 0 }
    return usage.data.reduce(
      (acc, d) => ({
        requests: acc.requests + d.total_requests,
        tokens: acc.tokens + d.total_tokens,
        cost: acc.cost + d.cost_estimate,
      }),
      { requests: 0, tokens: 0, cost: 0 },
    )
  }, [usage])

  const sortedData = useMemo(() => {
    if (!usage?.data) return []
    return [...usage.data].sort((a, b) => b.total_tokens - a.total_tokens)
  }, [usage])

  const columns = useMemo(() => buildColumns(groupBy), [groupBy])

  const isDataLoading = isLoading && !!me && (crossOrg ? isSystemAdmin : canViewOrgUsage ? !!orgId : true)
  const loadFailed = activeResult.isError && usage == null

  const totalPrompt = usage?.data?.reduce((s, d) => s + d.prompt_tokens, 0) ?? 0
  const totalCompletion = usage?.data?.reduce((s, d) => s + d.completion_tokens, 0) ?? 0

  const top5 = sortedData.slice(0, 5)

  const noData = (
    <EmptyState
      icon={<ChartColumn className="w-6 h-6" />}
      title="No usage"
      description="No LLM requests were recorded in the selected time range."
      className="py-8"
    />
  )

  return (
    <div className="min-w-0">
      {/* Top controls: scope toggle + time range */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {isSystemAdmin && <UsageScopeToggle crossOrg={crossOrg} onChange={handleCrossOrgToggle} />}
        <TimeRangePicker value={range} onChange={setRange} />
      </div>

      {loadFailed ? (
        <ErrorState
          variant="card"
          title="Couldn't load LLM usage"
          error={activeResult.error}
          onRetry={() => void activeResult.refetch()}
          retrying={activeResult.isFetching}
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {isDataLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)
            ) : (
              <>
                <StatCard
                  label="Total Requests"
                  value={formatTokens(totals.requests)}
                  icon={<Activity className="w-4 h-4" />}
                  iconColor="purple"
                />
                <StatCard
                  label="Total Tokens"
                  value={formatTokens(totals.tokens)}
                  icon={<Sparkles className="w-4 h-4" />}
                  iconColor="blue"
                />
                <StatCard
                  label="Est. Cost"
                  value={formatCost(totals.cost)}
                  icon={<DollarSign className="w-4 h-4" />}
                  iconColor="green"
                />
              </>
            )}
          </div>

          {/* Usage over Time chart - not shown in cross-org mode */}
          {!crossOrg && (
            <Card className="mb-6">
              <CardHeader
                title="Usage over Time"
                description={`Requests per ${trendGroup}. Select a point to open its requests.`}
                className="flex-wrap"
                actions={
                  <Toggle
                    checked={compare}
                    onChange={setCompare}
                    size="sm"
                    label="Compare to previous period"
                    aria-label="Compare to previous period"
                  />
                }
              />
              {trendQuery.isError && trendData == null ? (
                <ErrorState
                  title="Couldn't load usage trend"
                  error={trendQuery.error}
                  onRetry={() => void trendQuery.refetch()}
                  retrying={trendQuery.isFetching}
                />
              ) : trendQuery.isLoading ? (
                <Skeleton className="h-[220px] w-full rounded-lg" />
              ) : (trendData ?? []).length === 0 && !(compare && (prevData ?? []).length > 0) ? (
                noData
              ) : (
                <TimeSeriesChart
                  ariaLabel={`Requests per ${trendGroup}`}
                  data={trendPoints}
                  height={220}
                  formatValue={formatNumber}
                  seriesLabel="This period"
                  previousLabel="Previous period"
                  showPrevious={compare}
                  getPointHref={(_, i) =>
                    requestLogsUrl({ range: bucketRange(trendPoints[i].bucket, trendGroup) ?? range })
                  }
                  pointActionLabel="view requests in request logs"
                />
              )}
            </Card>
          )}

          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-tertiary whitespace-nowrap">Group by</span>
              <div className="w-36">
                <Select value={groupBy} onChange={setGroupBy} options={groupByOptions} fullWidth />
              </div>
            </div>
            <ExportButtons
              data={sortedData}
              headers={USAGE_EXPORT_HEADERS}
              filenamePrefix={`wai-usage-${groupBy}`}
              subject="usage"
            />
          </div>

          {/* Main table (Table scrolls horizontally inside its own container) */}
          <Table<UsageDataPoint>
            columns={columns}
            data={sortedData}
            keyExtractor={(row) => row.group_key}
            loading={isDataLoading}
            emptyState={noData}
          />

          {/* Bottom row - Top by Tokens + Token Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="min-w-0">
              <CardHeader title="Top by Tokens" />
              {isDataLoading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : top5.length === 0 ? (
                noData
              ) : (
                <HorizontalBar
                  items={top5.map((d) => ({
                    label: groupDisplayValue(d),
                    value: d.total_tokens,
                    detail: formatTokens(d.total_tokens),
                  }))}
                />
              )}
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Token Distribution" />
              {isDataLoading ? (
                <div className="flex justify-center">
                  <Skeleton className="w-48 h-48 rounded-full" />
                </div>
              ) : totalPrompt + totalCompletion === 0 ? (
                noData
              ) : (
                <DonutChart
                  segments={[
                    { label: 'Prompt', value: totalPrompt, color: chartColor(1) },
                    { label: 'Completion', value: totalCompletion, color: chartColor(0) },
                  ]}
                  centerLabel="Total"
                  centerValue={formatTokens(totalPrompt + totalCompletion)}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CrossOrgData helper - kept local to avoid leaking the type
// ---------------------------------------------------------------------------

interface CrossOrgDataProps {
  from: string
  to: string
  groupBy: string
  enabled: boolean
}

function useCrossOrgData({ from, to, groupBy, enabled }: CrossOrgDataProps) {
  return useCrossOrgUsage({ from, to, groupBy }, enabled)
}
