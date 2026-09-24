import { useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Select } from '../../components/ui/Select'
import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { TimeAgo } from '../../components/ui/TimeAgo'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { BellRing, CircleAlert, CircleCheck, CircleX, Info, OctagonAlert, TriangleAlert } from '../../components/ui/icons'
import { useAlertEvents } from '../../hooks/useAlerts'
import type { AlertEventItem, AlertScope, AlertSeverity } from '../../hooks/useAlerts'
import { KIND_LABEL, SEVERITY_LABEL, SEVERITY_VARIANT } from './alertMeta'

const SEVERITY_ICON: Record<AlertSeverity, React.ReactNode> = {
  info: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
  warning: <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />,
  critical: <OctagonAlert className="h-3.5 w-3.5" aria-hidden="true" />,
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity] ?? 'info'} icon={SEVERITY_ICON[severity] ?? SEVERITY_ICON.info}>
      {SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  )
}

function DeliverySummary({ event }: { event: AlertEventItem }) {
  const total = event.delivery.length
  if (total === 0) return <span className="text-sm text-text-tertiary">Recorded, no channel</span>
  const ok = event.delivery.filter((d) => d.ok).length
  const failed = event.delivery.filter((d) => !d.ok)
  const detail = event.delivery
    .map((d) => `${d.name || d.channel_id}: ${d.ok ? 'delivered' : d.error || `HTTP ${d.status}`}`)
    .join('\n')
  if (ok === total) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-success" title={detail}>
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        Delivered {ok}/{total}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm text-error" title={detail}>
      {ok === 0 ? (
        <CircleX className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      Failed {failed.length}/{total}
    </span>
  )
}

const KIND_OPTIONS = [
  { value: '', label: 'All kinds' },
  ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
]
const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  ...(Object.keys(SEVERITY_LABEL) as AlertSeverity[]).map((s) => ({ value: s, label: SEVERITY_LABEL[s] })),
]

export function EventsCard({ scope, orgNames }: { scope: AlertScope; orgNames?: Map<string, string> }) {
  const [kind, setKind] = useState('')
  const [severity, setSeverity] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [prev, setPrev] = useState<string[]>([])
  const query = useAlertEvents(scope, { kind, severity, cursor })
  const page = query.data

  function resetPaging() {
    setCursor(undefined)
    setPrev([])
  }

  const columns: Column<AlertEventItem>[] = [
    { key: 'severity', header: 'Severity', render: (e) => <SeverityBadge severity={e.severity} /> },
    {
      key: 'event',
      header: 'Event',
      render: (e) => (
        <div className="min-w-[12rem] max-w-[28rem]">
          <p className="truncate font-medium text-text-primary" title={e.title}>
            {e.title}
          </p>
          <p className="line-clamp-2 text-xs text-text-secondary">{e.message}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {KIND_LABEL[e.kind] ?? e.kind}
            {!scope && (
              <>
                {' · '}
                {e.org_id ? (orgNames?.get(e.org_id) ?? e.org_id) : 'Platform'}
              </>
            )}
          </p>
        </div>
      ),
    },
    { key: 'time', header: 'Time', render: (e) => <TimeAgo date={e.created_at} className="whitespace-nowrap" /> },
    { key: 'delivery', header: 'Delivery', render: (e) => <DeliverySummary event={e} /> },
  ]

  return (
    <Card as="section" aria-labelledby="alert-events-heading">
      <CardHeader
        title={<span id="alert-events-heading">Recent events</span>}
        description="Alerts that fired in this scope, kept for 30 days."
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Select
          label="Kind"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(v) => {
            setKind(v)
            resetPaging()
          }}
        />
        <Select
          label="Severity"
          options={SEVERITY_OPTIONS}
          value={severity}
          onChange={(v) => {
            setSeverity(v)
            resetPaging()
          }}
        />
      </div>
      {query.isError && !page ? (
        <ErrorState title="Couldn't load events" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <Table<AlertEventItem>
          columns={columns}
          data={page?.data ?? []}
          keyExtractor={(e) => e.id}
          loading={query.isPending}
          compact
          emptyState={
            <EmptyState
              icon={<BellRing className="h-6 w-6" />}
              title={kind || severity ? 'No matching events' : 'No alerts yet'}
              description={kind || severity ? 'Try other filters.' : 'Fired alerts and test sends appear here.'}
            />
          }
          pagination={
            page && (page.has_more || prev.length > 0)
              ? {
                  cursor: cursor ?? null,
                  hasMore: page.has_more,
                  hasPrevious: prev.length > 0,
                  onNext: () => {
                    if (page.next_cursor) {
                      setPrev((p) => [...p, cursor ?? ''])
                      setCursor(page.next_cursor)
                    }
                  },
                  onPrevious: () => {
                    const last = prev[prev.length - 1]
                    setPrev((p) => p.slice(0, -1))
                    setCursor(last || undefined)
                  },
                }
              : undefined
          }
        />
      )}
    </Card>
  )
}
