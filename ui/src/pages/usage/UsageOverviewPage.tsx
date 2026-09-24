import { Link } from 'react-router-dom'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { AreaChart } from '../../components/ui/charts'
import { Activity, ArrowRight, ChartColumn, CircleCheck, Clock, DollarSign, Sparkles, Wrench } from '../../components/ui/icons'
import { StatCardSkeletons } from '../../components/analytics/StatCardSkeletons'
import { useMe } from '../../hooks/useMe'
import { useUsage, useMyUsage } from '../../hooks/useUsage'
import { useMCPUsage, useMyMCPUsage } from '../../hooks/useMCPUsage'
import { chartColor } from '../../lib/chartColors'
import { useTimeRange } from '../../lib/timeRange'
import { formatNumber, formatTokens, formatCost } from '../../lib/utils'

const ICON = 'w-4 h-4'

interface PanelQuery {
  isError: boolean
  error: unknown
  isFetching: boolean
  data: unknown
  refetch: () => unknown
}

function PanelHeader({ title, to }: { title: string; to: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <Link
        to={to}
        className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors no-underline"
      >
        View Details
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    </div>
  )
}

function PanelError({ query, title }: { query: PanelQuery; title: string }) {
  return (
    <ErrorState
      title={title}
      error={query.error}
      onRetry={() => void query.refetch()}
      retrying={query.isFetching}
      className="py-8"
    />
  )
}

function TrendEmpty({ description }: { description: string }) {
  return (
    <EmptyState icon={<ChartColumn className="w-6 h-6" />} title="No activity" description={description} className="py-6" />
  )
}

// ---------------------------------------------------------------------------
// UsageOverviewPage
// ---------------------------------------------------------------------------

export default function UsageOverviewPage() {
  const { data: me } = useMe()
  const orgId = me?.org_id ?? ''
  const canViewOrgUsage = me?.is_system_admin === true || me?.role === 'org_admin'

  const { from: from24h, to: to24h } = useTimeRange('24h')
  const { from: from7d, to: to7d } = useTimeRange('7d')

  // LLM: 24h totals + 7d daily trend
  const orgLlmTotals = useUsage(orgId, from24h, to24h, 'model', !!me && canViewOrgUsage)
  const myLlmTotals = useMyUsage(from24h, to24h, 'model', !!me && !canViewOrgUsage)
  const orgLlmTrend = useUsage(orgId, from7d, to7d, 'day', !!me && canViewOrgUsage)
  const myLlmTrend = useMyUsage(from7d, to7d, 'day', !!me && !canViewOrgUsage)
  const llmTotals = canViewOrgUsage ? orgLlmTotals : myLlmTotals
  const llmTrend = canViewOrgUsage ? orgLlmTrend : myLlmTrend

  // MCP: 24h totals + 7d daily trend
  const orgMcpTotals = useMCPUsage(orgId, from24h, to24h, 'server', !!me && canViewOrgUsage)
  const myMcpTotals = useMyMCPUsage(from24h, to24h, 'server', !!me && !canViewOrgUsage)
  const orgMcpTrend = useMCPUsage(orgId, from7d, to7d, 'day', !!me && canViewOrgUsage)
  const myMcpTrend = useMyMCPUsage(from7d, to7d, 'day', !!me && !canViewOrgUsage)
  const mcpTotals = canViewOrgUsage ? orgMcpTotals : myMcpTotals
  const mcpTrend = canViewOrgUsage ? orgMcpTrend : myMcpTrend

  const llmSummary = (llmTotals.data?.data ?? []).reduce(
    (acc, d) => ({
      requests: acc.requests + d.total_requests,
      tokens: acc.tokens + d.total_tokens,
      cost: acc.cost + d.cost_estimate,
    }),
    { requests: 0, tokens: 0, cost: 0 },
  )

  const mcpSummary = (mcpTotals.data?.data ?? []).reduce(
    (acc, d) => ({
      calls: acc.calls + d.total_calls,
      success: acc.success + d.success_count,
      totalDurationMs: acc.totalDurationMs + d.avg_duration_ms * d.total_calls,
    }),
    { calls: 0, success: 0, totalDurationMs: 0 },
  )

  const mcpSuccessRate = mcpSummary.calls > 0 ? (mcpSummary.success / mcpSummary.calls) * 100 : 0
  const mcpAvgDuration = mcpSummary.calls > 0 ? mcpSummary.totalDurationMs / mcpSummary.calls : 0

  const llmLoading = llmTotals.isLoading && (canViewOrgUsage ? !!orgId : !!me)
  const mcpLoading = mcpTotals.isLoading && (canViewOrgUsage ? !!orgId : !!me)

  const llmTrendData = llmTrend.data?.data ?? []
  const mcpTrendData = mcpTrend.data?.data ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LLM panel */}
      <Card className="min-w-0 flex flex-col gap-4">
        <PanelHeader title="LLM Usage" to="/usage/llm" />

        {llmTotals.isError && llmTotals.data == null ? (
          <PanelError query={llmTotals} title="Couldn't load LLM usage" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {llmLoading ? (
              <StatCardSkeletons count={3} />
            ) : (
              <>
                <StatCard label="Requests 24h" value={formatNumber(llmSummary.requests)} icon={<Activity className={ICON} />} iconColor="purple" className="p-3" />
                <StatCard label="Tokens 24h" value={formatTokens(llmSummary.tokens)} icon={<Sparkles className={ICON} />} iconColor="blue" className="p-3" />
                <StatCard label="Cost 24h" value={formatCost(llmSummary.cost)} icon={<DollarSign className={ICON} />} iconColor="green" className="p-3" />
              </>
            )}
          </div>
        )}

        <div>
          <p className="text-xs text-text-tertiary mb-3">Requests - last 7 days</p>
          {llmTrend.isError && llmTrend.data == null ? (
            <PanelError query={llmTrend} title="Couldn't load request trend" />
          ) : llmTrend.isLoading && (canViewOrgUsage ? !!orgId : !!me) ? (
            <Skeleton className="h-[140px] w-full rounded-lg" />
          ) : llmTrendData.length === 0 ? (
            <TrendEmpty description="No LLM requests in the last 7 days." />
          ) : (
            <AreaChart
              data={llmTrendData.map((d) => ({
                label: d.group_key.length > 10 ? d.group_key.slice(5) : d.group_key,
                value: d.total_requests,
              }))}
              height={140}
              formatValue={formatNumber}
            />
          )}
        </div>
      </Card>

      {/* MCP panel */}
      <Card className="min-w-0 flex flex-col gap-4">
        <PanelHeader title="MCP Usage" to="/usage/mcp" />

        {mcpTotals.isError && mcpTotals.data == null ? (
          <PanelError query={mcpTotals} title="Couldn't load MCP usage" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {mcpLoading ? (
              <StatCardSkeletons count={3} />
            ) : (
              <>
                <StatCard label="Tool Calls 24h" value={formatNumber(mcpSummary.calls)} icon={<Wrench className={ICON} />} iconColor="purple" className="p-3" />
                <StatCard label="Success Rate" value={`${mcpSuccessRate.toFixed(1)}%`} icon={<CircleCheck className={ICON} />} iconColor="green" className="p-3" />
                <StatCard
                  label="Avg Duration"
                  value={`${formatNumber(Math.round(mcpAvgDuration))} ms`}
                  icon={<Clock className={ICON} />}
                  iconColor="blue"
                  className="p-3"
                />
              </>
            )}
          </div>
        )}

        <div>
          <p className="text-xs text-text-tertiary mb-3">Tool calls - last 7 days</p>
          {mcpTrend.isError && mcpTrend.data == null ? (
            <PanelError query={mcpTrend} title="Couldn't load tool-call trend" />
          ) : mcpTrend.isLoading && (canViewOrgUsage ? !!orgId : !!me) ? (
            <Skeleton className="h-[140px] w-full rounded-lg" />
          ) : mcpTrendData.length === 0 ? (
            <TrendEmpty description="No MCP tool calls in the last 7 days." />
          ) : (
            <AreaChart
              data={mcpTrendData.map((d) => ({
                label: d.group_key.length > 10 ? d.group_key.slice(5) : d.group_key,
                value: d.total_calls,
              }))}
              height={140}
              color={chartColor(6)}
              formatValue={formatNumber}
            />
          )}
        </div>
      </Card>
    </div>
  )
}
