import { useState, useMemo } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Banner } from '../components/ui/Banner'
import { Badge } from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import { Dialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { QueryState } from '../components/ui/QueryState'
import { Skeleton } from '../components/ui/Skeleton'
import { TimeRangePicker } from '../components/ui/TimeRangePicker'
import {
  Activity,
  ChartColumn,
  CircleX,
  DollarSign,
  ExternalLink,
  HeartPulse,
  KeyRound,
  TriangleAlert,
  Zap,
} from '../components/ui/icons'
import { AreaChart } from '../components/ui/charts/AreaChart'
import { DonutChart } from '../components/ui/charts/DonutChart'
import { HorizontalBar } from '../components/ui/charts/HorizontalBar'
import { MiniTable } from '../components/ui/charts/MiniTable'
import type { MiniTableColumn } from '../components/ui/charts/MiniTable'
import { useMe } from '../hooks/useMe'
import { useDashboardStats } from '../hooks/useDashboardStats'
import type { BudgetWarning } from '../hooks/useDashboardStats'
import type { UsageDataPoint } from '../hooks/useUsage'
import { useUsage, useMyUsage } from '../hooks/useUsage'
import { useOrg } from '../hooks/useOrg'
import { useModelHealth } from '../hooks/useModelHealth'
import type { ModelHealthInfo } from '../hooks/useModelHealth'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import { formatTokens, formatCost, formatNumber } from '../lib/utils'
import { chartColor } from '../lib/chartColors'
import {
  DASHBOARD_TIME_RANGE_PRESETS,
  timeRangeLabel,
  useTimeRange,
  type TimeRangeValue,
} from '../lib/timeRange'

// ---------------------------------------------------------------------------
// BudgetWarningBanners
// ---------------------------------------------------------------------------

function BudgetWarningBanners({ warnings }: { warnings: BudgetWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <Banner
          key={`${w.scope}-${w.window}`}
          variant={w.percent_used > 0.9 ? 'error' : 'warning'}
          title={`${w.window === 'daily' ? 'Daily' : 'Monthly'} token budget: ${formatNumber(w.usage)} / ${formatNumber(w.limit)} (${Math.round(w.percent_used * 100)}% used)`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProgressBar (token budget)
// ---------------------------------------------------------------------------

function ProgressBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const color = pct > 90 ? 'bg-error' : pct > 70 ? 'bg-warning' : 'bg-accent'
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-tertiary tabular-nums">
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </div>
      <div
        className="h-2 bg-bg-tertiary rounded-full overflow-hidden"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${Math.round(pct)}% used`}
      >
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BudgetSection
// ---------------------------------------------------------------------------

function BudgetSection({ orgId, tokens24h }: { orgId: string; tokens24h: number }) {
  const { data: org } = useOrg(orgId)
  if (!org || org.daily_token_limit <= 0) return null
  return (
    <Card>
      <CardHeader title="Token Budget" />
      <div className="space-y-4">
        <ProgressBar label="Daily Token Budget" used={tokens24h} limit={org.daily_token_limit} />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Performance badge
// ---------------------------------------------------------------------------

function PerfBadge({ ms }: { ms: number }) {
  if (ms <= 0) return null
  if (ms < 100) return <Badge variant="success">Fast</Badge>
  if (ms < 500) return <Badge variant="warning">Normal</Badge>
  return <Badge variant="error">Slow</Badge>
}

// ---------------------------------------------------------------------------
// MiniTable column definitions — uses health check latency (server ping)
// instead of avg request duration which is misleading for streaming.
// ---------------------------------------------------------------------------

interface PerfRow {
  group_key: string
  health_latency_ms: number
  tps: number
}

function buildPerfRows(topModels: UsageDataPoint[], healthData: ModelHealthInfo[]): PerfRow[] {
  const healthMap = new Map(healthData.map((h) => [h.name, h]))
  return topModels.map((m) => {
    const h = healthMap.get(m.group_key)
    const tps = m.total_requests > 0 && m.avg_duration_ms > 0
      ? Math.round((m.total_tokens / m.total_requests) / (m.avg_duration_ms / 1000))
      : 0
    return {
      group_key: m.group_key,
      health_latency_ms: h?.latency_ms ?? 0,
      tps,
    }
  })
}

const performanceColumns: MiniTableColumn<PerfRow>[] = [
  {
    key: 'model',
    header: 'Model',
    render: (row) => (
      <span className="font-mono text-text-primary text-xs">{row.group_key}</span>
    ),
  },
  {
    key: 'latency',
    header: 'Latency',
    align: 'right',
    render: (row) => (
      <div className="flex items-center justify-end gap-2">
        <span className="text-text-secondary tabular-nums">
          {row.health_latency_ms > 0 ? `${row.health_latency_ms}ms` : '—'}
        </span>
        <PerfBadge ms={row.health_latency_ms} />
      </div>
    ),
  },
  {
    key: 'tps',
    header: 'Throughput',
    align: 'right',
    render: (row) => (
      <span className="text-text-secondary tabular-nums">
        {row.tps > 0 ? `${formatNumber(row.tps)} tok/s` : '—'}
      </span>
    ),
  },
]

const ICON = 'w-4 h-4'

function SectionSkeletonBars({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function SectionEmpty({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      icon={<ChartColumn className="w-6 h-6" />}
      title={title}
      description={description}
      className="py-8"
    />
  )
}

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

const scopeDescriptions: Record<string, string> = {
  org: 'Organization-wide usage overview',
  team: 'Your team usage overview',
  user: 'Your personal usage overview',
}

export default function DashboardPage() {
  const { data: me } = useMe()
  const statsQuery = useDashboardStats()
  const { data: stats, isLoading: statsLoading } = statsQuery
  const { data: updateInfo } = useUpdateCheck()
  const [timeRange, setTimeRange] = useState<TimeRangeValue>('7d')
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  const availableVersion = updateInfo?.available_version
  const [manualDismiss, setManualDismiss] = useState(false)

  const updateDismissed = manualDismiss || !availableVersion ||
    localStorage.getItem(`update_dismissed_${availableVersion}`) === 'true'

  function dismissUpdate() {
    if (updateInfo?.available_version) {
      localStorage.setItem(`update_dismissed_${updateInfo.available_version}`, 'true')
    }
    setManualDismiss(true)
    setShowUpdateDialog(false)
  }

  const canViewOrgUsage = me?.is_system_admin === true || me?.role === 'org_admin'
  const orgId = me?.org_id ?? ''

  // Time-series, top models and team usage all share the page-level range
  const { from, to, preset } = useTimeRange(timeRange)
  const emptyPeriodDescription =
    preset != null
      ? `No usage recorded in the ${timeRangeLabel(timeRange, 'long').toLowerCase()}.`
      : 'No usage recorded in the selected range.'

  const orgTopModels = useUsage(orgId, from, to, 'model', !!me && canViewOrgUsage)
  const myTopModels = useMyUsage(from, to, 'model', !!me && !canViewOrgUsage)
  const topModelsQuery = canViewOrgUsage ? orgTopModels : myTopModels
  const { data: topModels } = topModelsQuery
  const { data: modelHealth } = useModelHealth()

  // Performance rows combining usage data with health check latency
  const perfRows = useMemo(
    () => buildPerfRows(topModels?.data ?? [], modelHealth?.models ?? []),
    [topModels?.data, modelHealth?.models],
  )

  const orgUsageSeries = useUsage(orgId, from, to, 'day', !!me && canViewOrgUsage)
  const myUsageSeries = useMyUsage(from, to, 'day', !!me && !canViewOrgUsage)
  const seriesQuery = canViewOrgUsage ? orgUsageSeries : myUsageSeries

  // Team usage (admin only)
  const teamUsageQuery = useUsage(orgId, from, to, 'team', !!me && canViewOrgUsage)

  const scope = stats?.scope ?? (canViewOrgUsage ? 'org' : 'user')
  const description = scopeDescriptions[scope] ?? 'Your wai usage overview'

  const healthCounts = useMemo(() => {
    const fromStats = (stats?.models_healthy ?? 0) + (stats?.models_degraded ?? 0) + (stats?.models_unhealthy ?? 0)
    if (fromStats > 0) {
      return {
        healthy: stats?.models_healthy ?? 0,
        degraded: stats?.models_degraded ?? 0,
        unhealthy: stats?.models_unhealthy ?? 0,
      }
    }
    const models = modelHealth?.models ?? []
    return {
      healthy: models.filter((m) => m.status === 'healthy').length,
      degraded: models.filter((m) => m.status === 'degraded').length,
      unhealthy: models.filter((m) => m.status === 'unhealthy').length,
    }
  }, [stats, modelHealth])

  const showModelHealth = healthCounts.healthy + healthCounts.degraded + healthCounts.unhealthy > 0

  // Build horizontal bar data for top models
  const topModelsBars = useMemo(() => {
    if (!topModels?.data) return []
    return [...topModels.data]
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .slice(0, 6)
      .map((m) => ({
        label: m.group_key,
        value: m.total_tokens,
        detail: `${formatTokens(m.total_tokens)} Tokens`,
      }))
  }, [topModels])

  // Build donut segments from prompt/completion token split
  const donutSegments = useMemo(() => {
    if (!topModels?.data || topModels.data.length === 0) return []
    const totalPrompt = topModels.data.reduce((acc, m) => acc + m.prompt_tokens, 0)
    const totalCompletion = topModels.data.reduce((acc, m) => acc + m.completion_tokens, 0)
    if (totalPrompt + totalCompletion === 0) return []
    return [
      { label: 'Prompt', value: totalPrompt, color: chartColor(1) },
      { label: 'Completion', value: totalCompletion, color: chartColor(0) },
    ]
  }, [topModels])

  const statValue = (render: () => string) => (statsLoading ? '…' : stats == null ? '—' : render())

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={description}
        actions={
          <TimeRangePicker
            value={timeRange}
            onChange={setTimeRange}
            presets={DASHBOARD_TIME_RANGE_PRESETS}
            size="sm"
            aria-label="Dashboard time range"
          />
        }
      />

      <div className="min-w-0 space-y-6">
        {/* Budget warnings */}
        {(stats?.budget_warnings?.length ?? 0) > 0 && (
          <BudgetWarningBanners warnings={stats?.budget_warnings ?? []} />
        )}

        {/* Update notification */}
        {updateInfo?.needs_update && !updateDismissed && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Banner
              variant="info"
              className="min-w-0 flex-1"
              title={`wai ${updateInfo.available_version} is available (current: ${updateInfo.current_version})`}
              onDismiss={dismissUpdate}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowUpdateDialog(true)}
              className="self-start sm:self-auto"
            >
              View release notes
            </Button>
          </div>
        )}

        {/* Stat cards */}
        {statsQuery.isError && stats == null ? (
          <ErrorState
            variant="card"
            title="Couldn't load dashboard stats"
            error={statsQuery.error}
            onRetry={() => void statsQuery.refetch()}
            retrying={statsQuery.isFetching}
          />
        ) : statsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" aria-busy="true" aria-label="Loading stats">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[124px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard
              label="Requests (24h)"
              value={statValue(() => formatNumber(stats?.requests_24h ?? 0))}
              icon={<Activity className={ICON} />}
              iconColor="purple"
            />
            <StatCard
              label="Tokens (24h)"
              value={statValue(() => formatTokens(stats?.tokens_24h ?? 0))}
              icon={<Zap className={ICON} />}
              iconColor="blue"
            />
            <StatCard
              label="Est. Cost (24h)"
              value={statValue(() => formatCost(stats?.cost_estimate_24h ?? 0))}
              icon={<DollarSign className={ICON} />}
              iconColor="green"
            />
            <StatCard
              label="Active Keys"
              value={statValue(() => formatNumber(stats?.active_keys ?? 0))}
              icon={<KeyRound className={ICON} />}
              iconColor="pink"
            />
          </div>
        )}

        {/* Model Health summary */}
        {!statsLoading && showModelHealth && (
          <section aria-labelledby="dash-model-health">
            <h2 id="dash-model-health" className="text-sm font-medium text-text-tertiary uppercase tracking-wider mb-3">
              Model Health
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Healthy" value={healthCounts.healthy} icon={<HeartPulse className={ICON} />} iconColor="green" />
              <StatCard label="Degraded" value={healthCounts.degraded} icon={<TriangleAlert className={ICON} />} iconColor="yellow" />
              <StatCard label="Unhealthy" value={healthCounts.unhealthy} icon={<CircleX className={ICON} />} iconColor="red" />
            </div>
          </section>
        )}

        {/* Token budget section */}
        {canViewOrgUsage && me?.org_id != null && !statsLoading && (
          <BudgetSection orgId={me.org_id} tokens24h={stats?.tokens_24h ?? 0} />
        )}

        {/* Requests over time */}
        {me != null && (canViewOrgUsage ? orgId !== '' : true) && (
          <Card>
            <CardHeader title="Requests over Time" description={timeRangeLabel(timeRange, 'long')} />
            <QueryState
              query={seriesQuery}
              errorTitle="Couldn't load request history"
              loading={<Skeleton className="w-full rounded-lg h-[220px]" />}
              empty={<SectionEmpty title="No requests" description={emptyPeriodDescription} />}
            >
              {(series) => (
                <AreaChart
                  data={series.data.map((d) => ({ label: d.group_key, value: d.total_requests }))}
                  height={220}
                  color={chartColor(0)}
                  formatValue={formatNumber}
                />
              )}
            </QueryState>
          </Card>
        )}

        {/* Top models + token distribution */}
        {me != null && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="min-w-0">
              <CardHeader title="Top Models" description="By total tokens" />
              <QueryState
                query={topModelsQuery}
                errorTitle="Couldn't load model usage"
                loading={<SectionSkeletonBars />}
                empty={<SectionEmpty title="No model usage" description={emptyPeriodDescription} />}
              >
                {() => <HorizontalBar items={topModelsBars} />}
              </QueryState>
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Token Distribution" description="Prompt vs completion tokens" />
              <QueryState
                query={topModelsQuery}
                errorTitle="Couldn't load token distribution"
                loading={
                  <div className="flex justify-center">
                    <Skeleton className="w-48 h-48 rounded-full" />
                  </div>
                }
                isEmpty={() => donutSegments.length === 0}
                empty={<SectionEmpty title="No tokens" description={emptyPeriodDescription} />}
              >
                {() => (
                  <div className="flex justify-center">
                    <DonutChart
                      segments={donutSegments}
                      centerLabel="Total tokens"
                      centerValue={formatTokens(donutSegments.reduce((acc, s) => acc + s.value, 0))}
                      size={192}
                      strokeWidth={20}
                    />
                  </div>
                )}
              </QueryState>
            </Card>
          </div>
        )}

        {/* Team usage + model performance (admin only) */}
        {canViewOrgUsage && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="min-w-0">
              <CardHeader title="Usage by Team" description="By request count" />
              <QueryState
                query={teamUsageQuery}
                errorTitle="Couldn't load team usage"
                loading={<SectionSkeletonBars />}
                empty={<SectionEmpty title="No team usage" description={emptyPeriodDescription} />}
              >
                {(teamUsage) => (
                  <HorizontalBar
                    items={teamUsage.data.slice(0, 6).map((t) => ({
                      label: t.group_label || t.group_key,
                      value: t.total_requests,
                      detail: `${formatNumber(t.total_requests)} Req`,
                    }))}
                    color={chartColor(4)}
                  />
                )}
              </QueryState>
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Model Performance" description="Health-check latency and throughput" />
              <QueryState
                query={topModelsQuery}
                errorTitle="Couldn't load model performance"
                loading={
                  <div className="space-y-3" aria-hidden="true">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-8" />
                    ))}
                  </div>
                }
                isEmpty={() => perfRows.length === 0}
                empty={<SectionEmpty title="No model usage" description={emptyPeriodDescription} />}
              >
                {() => <MiniTable<PerfRow> columns={performanceColumns} data={perfRows} />}
              </QueryState>
            </Card>
          </div>
        )}
      </div>

      {/* Update detail dialog */}
      {updateInfo != null && (
        <Dialog
          open={showUpdateDialog}
          onClose={() => setShowUpdateDialog(false)}
          title={`wai ${updateInfo.available_version ?? ''}`}
          footer={
            <div className="flex flex-wrap gap-3">
              {updateInfo.release_url != null && (
                <a
                  href={updateInfo.release_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-bold bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-lg transition-all duration-200"
                >
                  View on GitHub
                  <ExternalLink className={ICON} aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              <Button variant="secondary" onClick={dismissUpdate}>
                Dismiss
              </Button>
            </div>
          }
        >
          <p className="text-xs text-text-tertiary mb-4">You are running {updateInfo.current_version}</p>
          {updateInfo.release_notes != null && (
            <div className="text-sm text-text-secondary whitespace-pre-wrap">{updateInfo.release_notes}</div>
          )}
        </Dialog>
      )}
    </>
  )
}
