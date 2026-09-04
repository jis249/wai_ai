import { useMemo, useState } from 'react'
import { StatCard } from '../../components/ui/StatCard'
import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
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
import { exportData } from '../../lib/export'

const TIME_RANGES = ['24h', '7d', '30d', '90d'] as const
type TimeRange = (typeof TIME_RANGES)[number]

const RANGE_HOURS: Record<TimeRange, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
  '90d': 2160,
}

function getTimeRange(range: TimeRange): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getTime() - RANGE_HOURS[range] * 3_600_000)
  return { from: from.toISOString(), to: now.toISOString() }
}

const VIEW_OPTIONS = [
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

function ActivityIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.88 5.76a1 1 0 00.95.69H21l-5.12 3.72a1 1 0 00-.36 1.12L17.4 20 12 16.28 6.6 20l1.88-5.71a1 1 0 00-.36-1.12L3 9.45h6.17a1 1 0 00.95-.69L12 3z" />
    </svg>
  )
}

function DollarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

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
  const [range, setRange] = useState<TimeRange>('7d')
  const [view, setView] = useState('user_model')
  const [crossOrg, setCrossOrg] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const { data: me } = useMe()
  const orgId = me?.org_id ?? ''
  const isSystemAdmin = me?.is_system_admin === true
  const canViewOrgUsage = isSystemAdmin || me?.role === 'org_admin'

  const { from, to } = useMemo(() => getTimeRange(range), [range])

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

  return (
    <>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {isSystemAdmin && (
          <div className="inline-flex gap-1 p-1 rounded-lg bg-bg-tertiary">
            <button
              type="button"
              onClick={() => setCrossOrg(false)}
              className={
                !crossOrg
                  ? 'px-4 py-1.5 rounded-md text-sm font-medium bg-bg-secondary text-text-primary shadow-sm transition-colors'
                  : 'px-4 py-1.5 rounded-md text-sm font-medium text-text-tertiary hover:text-text-secondary transition-colors'
              }
            >
              My Organization
            </button>
            <button
              type="button"
              onClick={() => setCrossOrg(true)}
              className={
                crossOrg
                  ? 'px-4 py-1.5 rounded-md text-sm font-medium bg-bg-secondary text-text-primary shadow-sm transition-colors'
                  : 'px-4 py-1.5 rounded-md text-sm font-medium text-text-tertiary hover:text-text-secondary transition-colors'
              }
            >
              All Organizations
            </button>
          </div>
        )}

        <div className="inline-flex gap-1 p-1 rounded-lg bg-bg-tertiary">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={
                range === r
                  ? 'px-3 py-1.5 rounded-md text-sm font-medium bg-bg-secondary text-text-primary shadow-sm transition-colors'
                  : 'px-3 py-1.5 rounded-md text-sm font-medium text-text-tertiary hover:text-text-secondary transition-colors'
              }
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-text-tertiary mb-6">
        Usage for requests sent with <span className="font-mono">model: &quot;auto&quot;</span>. Click a user row to
        expand the token breakdown by routed model.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Auto requests"
          value={isDataLoading ? '...' : formatNumber(usage?.total_requests ?? 0)}
          icon={<ActivityIcon />}
          iconColor="purple"
        />
        <StatCard
          label="Total tokens"
          value={isDataLoading ? '...' : formatTokens(usage?.total_tokens ?? 0)}
          icon={<SparklesIcon />}
          iconColor="blue"
        />
        <StatCard
          label="Est. cost"
          value={isDataLoading ? '...' : formatCost(usage?.cost_estimate ?? 0)}
          icon={<DollarIcon />}
          iconColor="green"
        />
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary whitespace-nowrap">View</span>
            <div className="w-44">
              <Select value={view} onChange={setView} options={VIEW_OPTIONS} fullWidth />
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportData(
                exportRows as unknown as Record<string, unknown>[],
                exportHeaders,
                `wai-auto-usage-${view}`,
                'csv',
              )
            }
            disabled={exportRows.length === 0}
          >
            <span className="flex items-center gap-1.5">
              <DownloadIcon />
              CSV
            </span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportData(
                exportRows as unknown as Record<string, unknown>[],
                exportHeaders,
                `wai-auto-usage-${view}`,
                'json',
              )
            }
            disabled={exportRows.length === 0}
          >
            <span className="flex items-center gap-1.5">
              <DownloadIcon />
              JSON
            </span>
          </Button>
        </div>
      </div>

      {view === 'user_model' ? (
        <Table<UserAutoUsageGroup>
          columns={userGroupColumns}
          data={userGroups}
          keyExtractor={userGroupKey}
          loading={isDataLoading}
          emptyMessage="No auto routing usage for the selected time range"
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
          emptyMessage="No auto routing usage for the selected time range"
        />
      )}

      <div className="mt-6 bg-bg-secondary rounded-xl border border-border p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-4">Top routed models by tokens</h3>
        <HorizontalBar
          items={topModels.map((d) => ({
            label: d.routed_model,
            value: d.total_tokens,
            detail: formatTokens(d.total_tokens),
          }))}
        />
      </div>
    </>
  )
}
