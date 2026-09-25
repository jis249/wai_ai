import { useMemo, useState } from 'react'
import { useActiveOrgId } from '../../hooks/useActiveOrg'
import { StatCard } from '../../components/ui/StatCard'
import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { TimeRangePicker } from '../../components/ui/TimeRangePicker'
import { Activity, DollarSign, Route, Sparkles } from '../../components/ui/icons'
import { ChartSection } from '../../components/analytics/ChartSection'
import { ExportButtons } from '../../components/analytics/ExportButtons'
import { StatCardSkeletons } from '../../components/analytics/StatCardSkeletons'
import { UsageScopeToggle } from '../../components/analytics/UsageScopeToggle'
import { HorizontalBar } from '../../components/ui/charts'
import { useMe } from '../../hooks/useMe'
import {
  useCrossOrgAutoUsage,
  useMyAutoUsage,
  useOrgAutoUsage,
  type AutoRoutingModelUsage,
  type AutoRoutingUsageRow,
} from '../../hooks/useAutoUsage'
import { formatCost, formatNumber, formatTokens } from '../../lib/utils'
import { useTimeRange, type TimeRangeValue } from '../../lib/timeRange'

type AutoUsageView = 'user_model' | 'model'

const VIEW_OPTIONS: { value: AutoUsageView; label: string }[] = [
  { value: 'user_model', label: 'By user' },
  { value: 'model', label: 'Routed model only' },
]

interface UserAutoUsageGroup {
  org_id: string
  org_label: string
  user_id: string
  user_label: string
  total_requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_estimate: number
  model_count: number
  models: AutoRoutingUsageRow[]
}

function groupByUser(rows: AutoRoutingUsageRow[]): UserAutoUsageGroup[] {
  const map = new Map<string, UserAutoUsageGroup>()
  for (const row of rows) {
    const key = `${row.org_id}:${row.user_id}`
    let group = map.get(key)
    if (!group) {
      group = {
        org_id: row.org_id,
        org_label: row.org_label,
        user_id: row.user_id,
        user_label: row.user_label,
        total_requests: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_estimate: 0,
        model_count: 0,
        models: [],
      }
      map.set(key, group)
    }
    group.total_requests += row.total_requests
    group.prompt_tokens += row.prompt_tokens
    group.completion_tokens += row.completion_tokens
    group.total_tokens += row.total_tokens
    group.cost_estimate += row.cost_estimate
    group.models.push(row)
  }
  for (const group of map.values()) {
    group.model_count = group.models.length
    group.models.sort((a, b) => b.total_tokens - a.total_tokens)
  }
  return [...map.values()].sort((a, b) => b.total_tokens - a.total_tokens)
}

function userGroupKey(group: UserAutoUsageGroup): string {
  return `${group.org_id}:${group.user_id}`
}

function UserModelBreakdown({
  models,
  defaultModel,
}: {
  models: AutoRoutingUsageRow[]
  defaultModel: string
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">
        Token breakdown by routed model
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary/50 border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Routed to
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Requests
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Prompt
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Completion
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Total tokens
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Cost
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary uppercase tracking-wider">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const userTotal = models.reduce((sum, m) => sum + m.total_tokens, 0)
              return models.map((model) => {
                const share = userTotal > 0 ? (model.total_tokens / userTotal) * 100 : 0
                return (
                  <tr key={model.routed_model} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      <span
                        className={`font-mono ${
                          model.routed_model === defaultModel ? 'text-text-primary' : 'text-accent'
                        }`}
                      >
                        {model.routed_model}
                      </span>
                      {model.routed_model === defaultModel && (
                        <span className="ml-2 text-xs text-text-tertiary">(default)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-text-secondary">{formatNumber(model.total_requests)}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{formatTokens(model.prompt_tokens)}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{formatTokens(model.completion_tokens)}</td>
                    <td className="px-4 py-2 text-right text-text-primary font-medium">{formatTokens(model.total_tokens)}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{formatCost(model.cost_estimate)}</td>
                    <td className="px-4 py-2 text-right text-text-tertiary">{share.toFixed(1)}%</td>
                  </tr>
                )
              })
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const USER_MODEL_EXPORT_HEADERS = [
  { key: 'user_label', label: 'User' },
  { key: 'default_model', label: 'Default Model' },
  { key: 'routed_model', label: 'Routed Model' },
  { key: 'total_requests', label: 'Requests' },
  { key: 'prompt_tokens', label: 'Prompt Tokens' },
  { key: 'completion_tokens', label: 'Completion Tokens' },
  { key: 'total_tokens', label: 'Total Tokens' },
  { key: 'cost_estimate', label: 'Cost' },
]

const MODEL_EXPORT_HEADERS = [
  { key: 'default_model', label: 'Default Model' },
  { key: 'routed_model', label: 'Routed Model' },
  { key: 'total_requests', label: 'Requests' },
  { key: 'prompt_tokens', label: 'Prompt Tokens' },
  { key: 'completion_tokens', label: 'Completion Tokens' },
  { key: 'total_tokens', label: 'Total Tokens' },
  { key: 'cost_estimate', label: 'Cost' },
]

function buildUserGroupColumns(
  showOrg: boolean,
  showUser: boolean,
  defaultModel: string,
): Column<UserAutoUsageGroup>[] {
  const cols: Column<UserAutoUsageGroup>[] = []
  if (showOrg) {
    cols.push({
      key: 'org_label',
      header: 'Organization',
      render: (row) => <span className="text-text-primary">{row.org_label || row.org_id || '—'}</span>,
    })
  }
  if (showUser) {
    cols.push({
      key: 'user_label',
      header: 'User',
      render: (row) => (
        <span className="text-text-primary font-medium">{row.user_label || row.user_id || '—'}</span>
      ),
    })
  }
  cols.push(
    {
      key: 'default_model',
      header: 'Default model',
      render: () => <span className="font-mono text-text-secondary">{defaultModel || '—'}</span>,
    },
    {
      key: 'model_count',
      header: 'Models used',
      align: 'right',
      render: (row) => <span className="text-text-secondary">{formatNumber(row.model_count)}</span>,
    },
    {
      key: 'total_requests',
      header: 'Requests',
      align: 'right',
      render: (row) => <span className="text-text-secondary">{formatNumber(row.total_requests)}</span>,
    },
    {
      key: 'prompt_tokens',
      header: 'Prompt tokens',
      align: 'right',
      render: (row) => <span className="text-text-secondary">{formatTokens(row.prompt_tokens)}</span>,
    },
    {
      key: 'completion_tokens',
      header: 'Completion tokens',
      align: 'right',
      render: (row) => <span className="text-text-secondary">{formatTokens(row.completion_tokens)}</span>,
    },
    {
      key: 'total_tokens',
      header: 'Total tokens',
      align: 'right',
      render: (row) => <span className="text-text-primary font-medium">{formatTokens(row.total_tokens)}</span>,
    },
    {
      key: 'cost_estimate',
      header: 'Cost',
      align: 'right',
      render: (row) => <span className="text-text-secondary">{formatCost(row.cost_estimate)}</span>,
    },
  )
  return cols
}

const buildModelColumns = (defaultModel: string): Column<AutoRoutingModelUsage>[] => [
  {
    key: 'default_model',
    header: 'Default model',
    render: () => (
      <span className="font-mono text-text-secondary">{defaultModel || '—'}</span>
    ),
  },
  {
    key: 'routed_model',
    header: 'Routed to',
    render: (row) => (
      <span className={`font-mono ${row.routed_model === defaultModel ? 'text-text-primary' : 'text-accent'}`}>
        {row.routed_model}
      </span>
    ),
  },
  {
    key: 'total_requests',
    header: 'Requests',
    align: 'right',
    render: (row) => <span className="text-text-secondary">{formatNumber(row.total_requests)}</span>,
  },
  {
    key: 'prompt_tokens',
    header: 'Prompt tokens',
    align: 'right',
    render: (row) => <span className="text-text-secondary">{formatTokens(row.prompt_tokens)}</span>,
  },
  {
    key: 'completion_tokens',
    header: 'Completion tokens',
    align: 'right',
    render: (row) => <span className="text-text-secondary">{formatTokens(row.completion_tokens)}</span>,
  },
  {
    key: 'total_tokens',
    header: 'Total tokens',
    align: 'right',
    render: (row) => <span className="text-text-primary font-medium">{formatTokens(row.total_tokens)}</span>,
  },
  {
    key: 'cost_estimate',
    header: 'Cost',
    align: 'right',
    render: (row) => <span className="text-text-secondary">{formatCost(row.cost_estimate)}</span>,
  },
]

export default function AutoUsagePage() {
  const [range, setRange] = useState<TimeRangeValue>('7d')
  const [view, setView] = useState<AutoUsageView>('user_model')
  const [crossOrg, setCrossOrg] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const { data: me } = useMe()
  const orgId = useActiveOrgId()
  const isSystemAdmin = me?.is_system_admin === true
  const canViewOrgUsage = isSystemAdmin || me?.role === 'org_admin'

  const { from, to } = useTimeRange(range)

  const orgUsage = useOrgAutoUsage(orgId, from, to, !!me && canViewOrgUsage && !crossOrg)
  const myUsage = useMyAutoUsage(from, to, !!me && !canViewOrgUsage)
  const crossOrgUsage = useCrossOrgAutoUsage(from, to, crossOrg && isSystemAdmin)

  const activeResult = crossOrg && isSystemAdmin
    ? crossOrgUsage
    : canViewOrgUsage
      ? orgUsage
      : myUsage

  const { data: usage, isLoading } = activeResult
  const isDataLoading = isLoading && !!me
  const loadFailed = activeResult.isError && usage == null

  const showOrg = crossOrg && isSystemAdmin
  const showUser = canViewOrgUsage || crossOrg
  const defaultModel = usage?.default_model ?? ''

  const userGroups = useMemo(
    () => groupByUser(usage?.by_user_model ?? []),
    [usage?.by_user_model],
  )

  const userGroupColumns = useMemo(
    () => buildUserGroupColumns(showOrg, showUser, defaultModel),
    [showOrg, showUser, defaultModel],
  )

  const modelColumns = useMemo(
    () => buildModelColumns(defaultModel),
    [defaultModel],
  )

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const exportRows = useMemo(() => {
    if (view === 'model') {
      return (usage?.by_model ?? []).map((row) => ({ ...row, default_model: defaultModel }))
    }
    return (usage?.by_user_model ?? []).map((row) => ({ ...row, default_model: defaultModel }))
  }, [usage, view, defaultModel])

  const exportHeaders = view === 'model' ? MODEL_EXPORT_HEADERS : USER_MODEL_EXPORT_HEADERS

  const topModels = useMemo(() => {
    return [...(usage?.by_model ?? [])].sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 5)
  }, [usage])

  const emptyState = (
    <EmptyState
      icon={<Route className="w-6 h-6" />}
      title="No auto-routed requests"
      description='No requests with model "auto" were recorded in the selected time range.'
      className="py-8"
    />
  )

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {isSystemAdmin && <UsageScopeToggle crossOrg={crossOrg} onChange={setCrossOrg} />}
        <TimeRangePicker value={range} onChange={setRange} />
      </div>

      <p className="text-sm text-text-tertiary mb-6">
        Usage for requests sent with <span className="font-mono">model: &quot;auto&quot;</span>. Click a user row to
        expand the token breakdown by routed model.
      </p>

      {loadFailed ? (
        <ErrorState
          variant="card"
          title="Couldn't load auto-routing usage"
          error={activeResult.error}
          onRetry={() => void activeResult.refetch()}
          retrying={activeResult.isFetching}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {isDataLoading ? (
              <StatCardSkeletons count={3} />
            ) : (
              <>
                <StatCard
                  label="Auto requests"
                  value={formatNumber(usage?.total_requests ?? 0)}
                  icon={<Activity className="w-4 h-4" />}
                  iconColor="purple"
                />
                <StatCard
                  label="Total tokens"
                  value={formatTokens(usage?.total_tokens ?? 0)}
                  icon={<Sparkles className="w-4 h-4" />}
                  iconColor="blue"
                />
                <StatCard
                  label="Est. cost"
                  value={formatCost(usage?.cost_estimate ?? 0)}
                  icon={<DollarSign className="w-4 h-4" />}
                  iconColor="green"
                />
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
            <SegmentedControl<AutoUsageView>
              aria-label="Table view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
              size="sm"
            />
            <ExportButtons
              data={exportRows}
              headers={exportHeaders}
              filenamePrefix={`wai-auto-usage-${view}`}
              subject="auto-routing usage"
            />
          </div>

          {view === 'user_model' ? (
            <Table<UserAutoUsageGroup>
              columns={userGroupColumns}
              data={userGroups}
              keyExtractor={userGroupKey}
              loading={isDataLoading}
              emptyState={emptyState}
              expandedKeys={expandedKeys}
              onToggleExpand={toggleExpand}
              onRowClick={(row) => toggleExpand(userGroupKey(row))}
              renderExpandedRow={(row) => (
                <UserModelBreakdown models={row.models} defaultModel={defaultModel} />
              )}
            />
          ) : (
            <Table<AutoRoutingModelUsage>
              columns={modelColumns}
              data={usage?.by_model ?? []}
              keyExtractor={(row) => row.routed_model}
              loading={isDataLoading}
              emptyState={emptyState}
            />
          )}

          <ChartSection
            className="mt-6"
            title="Top routed models by tokens"
            loading={isDataLoading}
            isEmpty={topModels.length === 0}
            emptyTitle="No auto-routed requests"
            emptyDescription='No requests with model "auto" were recorded in the selected time range.'
          >
            <HorizontalBar
              items={topModels.map((d) => ({
                label: d.routed_model,
                value: d.total_tokens,
                detail: formatTokens(d.total_tokens),
              }))}
            />
          </ChartSection>
        </>
      )}
    </div>
  )
}
