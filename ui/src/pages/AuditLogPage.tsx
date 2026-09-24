/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { Badge, type BadgeProps } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { StatCard } from '../components/ui/StatCard'
import { TimeAgo } from '../components/ui/TimeAgo'
import { TimeRangePicker } from '../components/ui/TimeRangePicker'
import { Tooltip } from '../components/ui/Tooltip'
import { Activity, List, ScrollText, Search, User } from '../components/ui/icons'
import { ExportButtons } from '../components/analytics/ExportButtons'
import { StatCardSkeletons } from '../components/analytics/StatCardSkeletons'
import { useMe } from '../hooks/useMe'
import { useOrgs } from '../hooks/useOrgs'
import { useAuditLog } from '../hooks/useAuditLog'
import type { AuditEvent } from '../hooks/useAuditLog'
import { timeRangeKey, timeRangeLabel, useTimeRange, type TimeRangeValue } from '../lib/timeRange'

const RESOURCE_TYPE_OPTIONS = [
  { value: '', label: 'All Resources' },
  { value: 'orgs', label: 'Organizations' },
  { value: 'users', label: 'Users' },
  { value: 'models', label: 'Models' },
  { value: 'mcp-servers', label: 'MCP Servers' },
  { value: 'settings', label: 'Settings' },
  { value: 'auth', label: 'Auth' },
]

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'auth.login', label: 'Login' },
  { value: 'auth.login_failed', label: 'Login Failed' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'replace', label: 'Replace' },
  { value: 'delete', label: 'Delete' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '25', label: '25 / page' },
  { value: '50', label: '50 / page' },
  { value: '100', label: '100 / page' },
]

const EXPORT_HEADERS = [
  { key: 'timestamp', label: 'Time' },
  { key: 'actor_type', label: 'Actor Type' },
  { key: 'actor_display_name', label: 'Actor Name' },
  { key: 'actor_email', label: 'Actor Email' },
  { key: 'actor_id', label: 'Actor ID' },
  { key: 'action', label: 'Action' },
  { key: 'resource_type', label: 'Resource Type' },
  { key: 'resource_id', label: 'Resource ID' },
  { key: 'description', label: 'Details' },
  { key: 'ip_address', label: 'IP' },
  { key: 'status_code', label: 'Status' },
  { key: 'request_id', label: 'Request ID' },
]

type BadgeVariant = NonNullable<BadgeProps['variant']>

const ACTION_BADGE: Record<string, BadgeVariant> = {
  create: 'success',
  update: 'info',
  replace: 'info',
  delete: 'error',
  revoke: 'warning',
  activate: 'success',
  deactivate: 'muted',
  login: 'success',
  login_failed: 'error',
}

function actionBadgeVariant(action: string): BadgeVariant {
  const verb = action.split('.').pop() ?? action
  return ACTION_BADGE[verb.toLowerCase()] ?? 'muted'
}

function statusBadgeVariant(code: number): BadgeVariant {
  if (code >= 200 && code < 300) return 'success'
  if (code >= 400 && code < 500) return 'warning'
  if (code >= 500) return 'error'
  return 'muted'
}

function shortenId(id: string): string {
  if (!id) return '—'
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…`
}

function emailFromDescription(description: string): string {
  const match = description.match(/email=([^\s]+)/)
  return match?.[1] ?? ''
}

const columns: Column<AuditEvent>[] = [
  {
    key: 'timestamp',
    header: 'Time',
    render: (row) => <TimeAgo date={row.timestamp} />,
  },
  {
    key: 'actor',
    header: 'User',
    render: (row) => {
      const fallbackEmail = emailFromDescription(row.description)
      const label = row.actor_display_name || row.actor_email || fallbackEmail
      if (label) {
        return (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm text-text-primary truncate">
              {row.actor_display_name || row.actor_email || fallbackEmail}
            </span>
            {(row.actor_email || fallbackEmail) && row.actor_display_name && (
              <span className="text-xs text-text-tertiary truncate">
                {row.actor_email || fallbackEmail}
              </span>
            )}
            {row.actor_type && (
              <span className="text-[11px] text-text-tertiary capitalize">{row.actor_type}</span>
            )}
          </div>
        )
      }
      return (
        <Tooltip content={row.actor_id}>
          <span className="font-mono text-xs text-text-secondary">
            <span className="text-text-tertiary mr-1">{row.actor_type || 'unknown'}</span>
            {shortenId(row.actor_id)}
          </span>
        </Tooltip>
      )
    },
  },
  {
    key: 'action',
    header: 'Action',
    render: (row) => (
      <Badge variant={actionBadgeVariant(row.action)}>
        {row.action}
      </Badge>
    ),
  },
  {
    key: 'resource_type',
    header: 'Resource',
    render: (row) => (
      <div className="flex flex-col gap-0.5">
        <Badge variant="muted">{row.resource_type}</Badge>
        {row.resource_id && (
          <Tooltip content={row.resource_id}>
            <span className="font-mono text-[11px] text-text-tertiary">{shortenId(row.resource_id)}</span>
          </Tooltip>
        )}
      </div>
    ),
  },
  {
    key: 'description',
    header: 'Details',
    render: (row) => (
      row.description
        ? <code className="text-xs font-mono bg-bg-tertiary px-1.5 py-0.5 rounded text-text-secondary break-all">{row.description}</code>
        : <span className="text-text-tertiary">—</span>
    ),
  },
  {
    key: 'ip_address',
    header: 'IP',
    render: (row) => (
      <span className="font-mono text-xs text-text-tertiary">
        {row.ip_address || '—'}
      </span>
    ),
  },
  {
    key: 'request_id',
    header: 'Request',
    render: (row) => (
      <Tooltip content={row.request_id}>
        <span className="font-mono text-[11px] text-text-tertiary">
          {row.request_id ? shortenId(row.request_id) : '—'}
        </span>
      </Tooltip>
    ),
  },
  {
    key: 'status_code',
    header: 'Status',
    align: 'right',
    render: (row) => (
      <Badge variant={statusBadgeVariant(row.status_code)}>
        {row.status_code}
      </Badge>
    ),
  },
]

export default function AuditLogPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const [range, setRange] = useState<TimeRangeValue>('7d')
  const [resourceType, setResourceType] = useState('')
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [pageSize, setPageSize] = useState(50)
  const [cursors, setCursors] = useState<string[]>([''])
  const currentCursor = cursors[cursors.length - 1]

  const { data: me } = useMe()
  const isSystemAdmin = me?.is_system_admin === true
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const { data: orgsData } = useOrgs(undefined)
  const orgId = isSystemAdmin ? selectedOrgId : (me?.org_id ?? '')

  const { from, to, preset } = useTimeRange(range)
  const rangeKey = timeRangeKey(range)

  const canQuery = !!me && (isSystemAdmin || !!orgId)

  const auditQuery = useAuditLog({
    orgId,
    actorId: actorId.trim(),
    resourceType,
    action,
    from,
    to,
    limit: pageSize,
    cursor: currentCursor,
    enabled: canQuery,
  })
  const { data, isLoading } = auditQuery

  useEffect(() => {
    setCursors([''])
  }, [orgId, actorId, resourceType, action, rangeKey, pageSize])

  const events = data?.data ?? []
  const hasPrevious = cursors.length > 1
  const hasNext = data?.has_more ?? false
  const uniqueActors = new Set(events.map((e) => e.actor_id).filter(Boolean)).size
  const activeFilterCount = [resourceType, action, actorId.trim(), isSystemAdmin && selectedOrgId].filter(Boolean).length

  const orgOptions = useMemo(() => {
    const orgs = orgsData?.data ?? []
    return [
      { value: '', label: 'All organizations' },
      ...orgs.map((org) => ({ value: org.id, label: org.name })),
    ]
  }, [orgsData])

  function handleNext() {
    if (data?.cursor) {
      setCursors((prev) => [...prev, data.cursor!])
    }
  }

  function handlePrevious() {
    setCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }

  function clearFilters() {
    setResourceType('')
    setAction('')
    setActorId('')
    if (isSystemAdmin) setSelectedOrgId('')
  }

  const isDataLoading = isLoading && canQuery
  const loadFailed = auditQuery.isError && data == null

  const emptyState = activeFilterCount > 0 ? (
    <EmptyState
      icon={<Search className="w-6 h-6" />}
      title="No matching events"
      description="No audit events match the selected filters."
      action={{ label: 'Clear filters', onClick: clearFilters }}
      className="py-10"
    />
  ) : (
    <EmptyState
      icon={<ScrollText className="w-6 h-6" />}
      title="No audit events"
      description={
        preset != null
          ? `Nothing was recorded in the ${timeRangeLabel(range, 'long').toLowerCase()}.`
          : 'Nothing was recorded in the selected range.'
      }
      className="py-10"
    />
  )

  return (
    <div className="min-w-0">
      {!hideHeader && (
        <PageHeader
          title="Audit Log"
          description="Web app activity including user logins, admin changes, and API actions"
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {isDataLoading ? (
          <StatCardSkeletons count={2} />
        ) : (
          <>
            <StatCard label="Events on Page" value={events.length} icon={<List className="w-4 h-4" />} iconColor="purple" />
            <StatCard label="Unique Actors" value={uniqueActors} icon={<User className="w-4 h-4" />} iconColor="blue" />
          </>
        )}
        <StatCard
          label="Active Filters"
          value={activeFilterCount}
          icon={<Activity className="w-4 h-4" />}
          iconColor={activeFilterCount > 0 ? 'yellow' : 'purple'}
        />
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col xl:flex-row xl:items-end gap-4">
          <TimeRangePicker value={range} onChange={setRange} />

          <div
            role="group"
            aria-label="Audit log filters"
            className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-start gap-3 xl:ml-auto"
          >
            {isSystemAdmin && (
              <div className="w-full lg:w-52">
                <Select label="Organization" value={selectedOrgId} onChange={setSelectedOrgId} options={orgOptions} fullWidth />
              </div>
            )}
            <div className="w-full lg:w-44">
              <Select label="Resource" value={resourceType} onChange={setResourceType} options={RESOURCE_TYPE_OPTIONS} fullWidth />
            </div>
            <div className="w-full lg:w-40">
              <Select label="Action" value={action} onChange={setAction} options={ACTION_OPTIONS} fullWidth />
            </div>
            <div className="w-full lg:w-64">
              <Input
                label="Actor ID"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                placeholder="e.g. 3f2a9c1e-…"
                description="Exact user, key or service-account UUID (hover an actor in the table to see it)."
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            data={events}
            headers={EXPORT_HEADERS}
            filenamePrefix={`wai-audit-log-${preset ?? 'custom'}`}
            subject="audit events"
          />
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {loadFailed ? (
        <ErrorState
          variant="card"
          title="Couldn't load audit events"
          error={auditQuery.error}
          onRetry={() => void auditQuery.refetch()}
          retrying={auditQuery.isFetching}
        />
      ) : (
        <Table<AuditEvent>
          columns={columns}
          data={events}
          keyExtractor={(row) => row.id}
          loading={isDataLoading}
          emptyState={emptyState}
        />
      )}

      {events.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-text-tertiary">
              {events.length} events on this page
              {hasNext ? ' (more available)' : ''}
            </span>
            <div className="w-32">
              <Select
                value={String(pageSize)}
                onChange={(value) => setPageSize(Number(value))}
                options={PAGE_SIZE_OPTIONS}
                fullWidth
              />
            </div>
          </div>

          {(hasPrevious || hasNext) && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={!hasPrevious || isDataLoading} onClick={handlePrevious}>
                Previous
              </Button>
              <Button variant="ghost" size="sm" disabled={!hasNext || isDataLoading} onClick={handleNext}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
