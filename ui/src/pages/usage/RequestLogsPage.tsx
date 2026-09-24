import { Table } from '../../components/ui/Table'
import type { Column } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { TimeAgo } from '../../components/ui/TimeAgo'
import { useRequestLogs } from '../../hooks/useRequestLogs'
import type { RequestLogRow } from '../../hooks/useRequestLogs'

const columns: Column<RequestLogRow>[] = [
  {
    key: 'created_at',
    header: 'Time',
    render: (row) => <TimeAgo date={row.created_at} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <Badge variant={row.status < 400 ? 'success' : 'error'}>{row.status}</Badge>
    ),
  },
  { key: 'model', header: 'Model', render: (row) => row.model || '—' },
  { key: 'routed_model', header: 'Routed', render: (row) => row.routed_model || '—' },
  { key: 'key_hint', header: 'Key', render: (row) => <span className="font-mono text-xs">{row.key_hint || '—'}</span> },
  {
    key: 'tokens',
    header: 'Tokens',
    render: (row) => String((row.prompt_tokens || 0) + (row.completion_tokens || 0)),
  },
  {
    key: 'cost_usd',
    header: 'Cost',
    render: (row) => (row.cost_usd != null ? `$${row.cost_usd.toFixed(4)}` : '—'),
  },
  {
    key: 'latency_ms',
    header: 'Latency',
    render: (row) => (row.latency_ms != null ? `${row.latency_ms} ms` : '—'),
  },
  { key: 'cache_hit', header: 'Cache', render: (row) => (row.cache_hit ? 'hit' : '—') },
]

export default function RequestLogsPage() {
  const { data, isLoading } = useRequestLogs()
  const rows = data?.data ?? []

  return (
    <Table<RequestLogRow>
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      loading={isLoading}
      emptyMessage="No proxy requests logged yet"
    />
  )
}
