import { useMemo, useState } from 'react'
import { useActiveOrgId } from '../../hooks/useActiveOrg'
import { StatCard } from '../../components/ui/StatCard'
import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { Select } from '../../components/ui/Select'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { TimeRangePicker } from '../../components/ui/TimeRangePicker'
import { ChartColumn, CircleCheck, Clock, Terminal, Wrench } from '../../components/ui/icons'
import { ChartSection } from '../../components/analytics/ChartSection'
import { ExportButtons } from '../../components/analytics/ExportButtons'
import { StatCardSkeletons } from '../../components/analytics/StatCardSkeletons'
import { UsageScopeToggle } from '../../components/analytics/UsageScopeToggle'
import { AreaChart, DonutChart, HorizontalBar } from '../../components/ui/charts'
import { useMe } from '../../hooks/useMe'
import { useMCPUsage, useMyMCPUsage, useCrossOrgMCPUsage } from '../../hooks/useMCPUsage'
import type { MCPUsageDataPoint } from '../../hooks/useMCPUsage'
import { formatNumber } from '../../lib/utils'
import { useTimeRange, type TimeRangeValue } from '../../lib/timeRange'

const BASE_GROUP_BY_OPTIONS = [
  { value: 'server', label: 'Server' },
  { value: 'tool', label: 'Tool' },
  { value: 'team', label: 'Team' },
  { value: 'key', label: 'Key' },
  { value: 'user', label: 'User' },
  { value: 'day', label: 'Day' },
  { value: 'hour', label: 'Hour' },
  { value: 'status', label: 'Status' },
]

const CROSS_ORG_GROUP_BY_OPTIONS = [
  ...BASE_GROUP_BY_OPTIONS,
  { value: 'org', label: 'Org' },
]

const GROUP_BY_HEADERS: Record<string, string> = {
  server: 'Server',
  tool: 'Tool',
  team: 'Team',
  key: 'Key',
  user: 'User',
  day: 'Date',
  hour: 'Hour',
  status: 'Status',
  org: 'Org',
}

function buildColumns(groupBy: string): Column<MCPUsageDataPoint>[] {
  return [
    {
      key: 'group_key',
      header: GROUP_BY_HEADERS[groupBy] ?? 'Group',
      render: (row) => (
        <span className="font-mono text-text-primary">{row.group_key}</span>
      ),
    },
    {
      key: 'total_calls',
      header: 'Total Calls',
      align: 'right',
      render: (row) => (
        <span className="text-text-primary font-medium">{formatNumber(row.total_calls)}</span>
      ),
    },
    {
      key: 'success_count',
      header: 'Success',
      align: 'right',
      render: (row) => (
        <span className="text-success">{formatNumber(row.success_count)}</span>
      ),
    },
    {
      key: 'error_count',
      header: 'Errors',
      align: 'right',
      render: (row) => (
        <span className={row.error_count > 0 ? 'text-error' : 'text-text-tertiary'}>
          {formatNumber(row.error_count)}
        </span>
      ),
    },
    {
      key: 'timeout_count',
      header: 'Timeouts',
      align: 'right',
      render: (row) => (
        <span className={row.timeout_count > 0 ? 'text-warning' : 'text-text-tertiary'}>
          {formatNumber(row.timeout_count)}
        </span>
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
    {
      key: 'code_mode_calls',
      header: 'Code Mode',
      align: 'right',
      render: (row) => (
        <span className="text-text-secondary">{formatNumber(row.code_mode_calls)}</span>
      ),
    },
  ]
}

const MCP_EXPORT_HEADERS = [
  { key: 'group_key', label: 'Group' },
  { key: 'total_calls', label: 'Total Calls' },
  { key: 'success_count', label: 'Success' },
  { key: 'error_count', label: 'Errors' },
  { key: 'timeout_count', label: 'Timeouts' },
  { key: 'avg_duration_ms', label: 'Avg Duration (ms)' },
  { key: 'code_mode_calls', label: 'Code Mode Calls' },
]

// ---------------------------------------------------------------------------
// MCPUsagePage
// ---------------------------------------------------------------------------

export default function MCPUsagePage() {
  const [range, setRange] = useState<TimeRangeValue>('24h')
  const [groupBy, setGroupBy] = useState('server')
  const [crossOrg, setCrossOrg] = useState(false)

  const { data: me } = useMe()
  const orgId = useActiveOrgId()
  const isSystemAdmin = me?.is_system_admin === true
  const canViewOrgUsage = isSystemAdmin || me?.role === 'org_admin'

  const { from, to } = useTimeRange(range)

  const orgUsage = useMCPUsage(orgId, from, to, groupBy, !!me && canViewOrgUsage)
  const myUsage = useMyMCPUsage(from, to, groupBy, !!me && !canViewOrgUsage)
  const crossOrgUsage = useCrossOrgMCPUsage({ from, to, groupBy }, crossOrg && isSystemAdmin)

  const activeResult = crossOrg && isSystemAdmin
    ? crossOrgUsage
    : canViewOrgUsage
      ? orgUsage
      : myUsage

  const { data: usage, isLoading } = activeResult

  // Daily trend data - only when groupBy is not already 'day'/'hour'
  const needsDailyTrend = groupBy !== 'day' && groupBy !== 'hour'
  const orgDailyUsage = useMCPUsage(orgId, from, to, 'day', !!me && canViewOrgUsage && needsDailyTrend)
  const myDailyUsage = useMyMCPUsage(from, to, 'day', !!me && !canViewOrgUsage && needsDailyTrend)
  const dailyUsage = canViewOrgUsage ? orgDailyUsage : myDailyUsage
  const trendQuery = needsDailyTrend ? dailyUsage : activeResult
  const trendData = needsDailyTrend ? dailyUsage.data?.data : usage?.data

  const handleCrossOrgToggle = (next: boolean) => {
    if (next) {
      setGroupBy('org')
    } else if (groupBy === 'org') {
      setGroupBy('server')
    }
    setCrossOrg(next)
  }

  const groupByOptions = crossOrg && isSystemAdmin
    ? CROSS_ORG_GROUP_BY_OPTIONS
    : BASE_GROUP_BY_OPTIONS

  const totals = useMemo(() => {
    if (!usage?.data) return { calls: 0, success: 0, errors: 0, timeouts: 0, codeModes: 0, totalDurationMs: 0 }
    return usage.data.reduce(
      (acc, d) => ({
        calls: acc.calls + d.total_calls,
        success: acc.success + d.success_count,
        errors: acc.errors + d.error_count,
        timeouts: acc.timeouts + d.timeout_count,
        codeModes: acc.codeModes + d.code_mode_calls,
        totalDurationMs: acc.totalDurationMs + d.avg_duration_ms * d.total_calls,
      }),
      { calls: 0, success: 0, errors: 0, timeouts: 0, codeModes: 0, totalDurationMs: 0 },
    )
  }, [usage])

  const successRate = totals.calls > 0 ? (totals.success / totals.calls) * 100 : 0
  const avgDurationMs = totals.calls > 0 ? totals.totalDurationMs / totals.calls : 0

  const sortedData = useMemo(() => {
    if (!usage?.data) return []
    return [...usage.data].sort((a, b) => b.total_calls - a.total_calls)
  }, [usage])

  const columns = useMemo(() => buildColumns(groupBy), [groupBy])

  const isDataLoading = isLoading && !!me && (crossOrg ? isSystemAdmin : canViewOrgUsage ? !!orgId : true)
  const loadFailed = activeResult.isError && usage == null

  // Get top 10 by tool groupBy - use a separate query when current groupBy isn't 'tool'
  const orgToolGroupUsage = useMCPUsage(orgId, from, to, 'tool', !!me && canViewOrgUsage && groupBy !== 'tool')
  const myToolGroupUsage = useMyMCPUsage(from, to, 'tool', !!me && !canViewOrgUsage && groupBy !== 'tool')
  const toolGroupUsage = canViewOrgUsage ? orgToolGroupUsage : myToolGroupUsage
  const topTools = useMemo(() => {
    const source = groupBy === 'tool' ? sortedData : (toolGroupUsage.data?.data ?? [])
    return [...source].sort((a, b) => b.total_calls - a.total_calls).slice(0, 10)
  }, [groupBy, sortedData, toolGroupUsage.data])

  // For server groupBy - use a separate query when current groupBy isn't 'server'
  const orgServerGroupUsage = useMCPUsage(orgId, from, to, 'server', !!me && canViewOrgUsage && groupBy !== 'server')
  const myServerGroupUsage = useMyMCPUsage(from, to, 'server', !!me && !canViewOrgUsage && groupBy !== 'server')
  const serverGroupUsage = canViewOrgUsage ? orgServerGroupUsage : myServerGroupUsage
  const topServers = useMemo(() => {
    const source = groupBy === 'server' ? sortedData : (serverGroupUsage.data?.data ?? [])
    return [...source].sort((a, b) => b.total_calls - a.total_calls).slice(0, 10)
  }, [groupBy, sortedData, serverGroupUsage.data])

  const emptyDescription = 'No MCP tool calls were recorded in the selected time range.'

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
          title="Couldn't load MCP usage"
          error={activeResult.error}
          onRetry={() => void activeResult.refetch()}
          retrying={activeResult.isFetching}
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {isDataLoading ? (
              <StatCardSkeletons count={4} />
            ) : (
              <>
                <StatCard label="Tool Calls" value={formatNumber(totals.calls)} icon={<Wrench className="w-4 h-4" />} iconColor="purple" />
                <StatCard label="Success Rate" value={`${successRate.toFixed(1)}%`} icon={<CircleCheck className="w-4 h-4" />} iconColor="green" />
                <StatCard
                  label="Avg Duration"
                  value={`${formatNumber(Math.round(avgDurationMs))} ms`}
                  icon={<Clock className="w-4 h-4" />}
                  iconColor="blue"
                />
                <StatCard label="Code Mode Calls" value={formatNumber(totals.codeModes)} icon={<Terminal className="w-4 h-4" />} iconColor="yellow" />
              </>
            )}
          </div>

          {/* Calls over Time chart - hidden in cross-org mode */}
          {!crossOrg && (
            <ChartSection
              className="mb-6"
              title="Calls over Time"
              query={trendQuery}
              isEmpty={(trendData ?? []).length === 0}
              emptyTitle="No tool calls"
              emptyDescription={emptyDescription}
              errorTitle="Couldn't load call trend"
              skeletonClassName="h-[220px] w-full rounded-lg"
            >
              <AreaChart
                data={(trendData ?? []).map((d) => ({
                  label: d.group_key.length > 10 ? d.group_key.slice(5) : d.group_key,
                  value: d.total_calls,
                }))}
                height={220}
                formatValue={formatNumber}
              />
            </ChartSection>
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
              headers={MCP_EXPORT_HEADERS}
              filenamePrefix={`wai-mcp-usage-${groupBy}`}
              subject="MCP usage"
            />
          </div>

          {/* Main table (scrolls horizontally inside its own container) */}
          <Table<MCPUsageDataPoint>
            columns={columns}
            data={sortedData}
            keyExtractor={(row) => row.group_key}
            loading={isDataLoading}
            emptyState={
              <EmptyState
                icon={<ChartColumn className="w-6 h-6" />}
                title="No MCP usage"
                description={emptyDescription}
                className="py-8"
              />
            }
          />

          {/* Bottom charts - hidden in cross-org mode */}
          {!crossOrg && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <ChartSection
                title="Top Servers by Calls"
                query={groupBy === 'server' ? activeResult : serverGroupUsage}
                isEmpty={topServers.length === 0}
                emptyTitle="No server calls"
                emptyDescription={emptyDescription}
              >
                <HorizontalBar
                  items={topServers.map((d) => ({ label: d.group_key, value: d.total_calls, detail: formatNumber(d.total_calls) }))}
                />
              </ChartSection>

              <ChartSection
                title="Top Tools by Calls"
                query={groupBy === 'tool' ? activeResult : toolGroupUsage}
                isEmpty={topTools.length === 0}
                emptyTitle="No tool calls"
                emptyDescription={emptyDescription}
              >
                <HorizontalBar
                  items={topTools.map((d) => ({ label: d.group_key, value: d.total_calls, detail: formatNumber(d.total_calls) }))}
                />
              </ChartSection>
            </div>
          )}

          <div className="mt-6">
            <ChartSection
              className="max-w-sm"
              title="Status Distribution"
              loading={isDataLoading}
              isEmpty={totals.calls === 0}
              emptyTitle="No tool calls"
              emptyDescription={emptyDescription}
              skeletonClassName="mx-auto h-48 w-48 rounded-full"
            >
              <DonutChart
                segments={[
                  { label: 'Success', value: totals.success, color: 'var(--color-success)' },
                  { label: 'Error', value: totals.errors, color: 'var(--color-error)' },
                  { label: 'Timeout', value: totals.timeouts, color: 'var(--color-warning)' },
                ]}
                centerLabel="Total"
                centerValue={formatNumber(totals.calls)}
              />
            </ChartSection>
          </div>
        </>
      )}
    </div>
  )
}
