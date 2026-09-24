import { Badge } from '../../components/ui/Badge'
import { CircleCheck, CircleX, Zap } from '../../components/ui/icons'
import { isSuccessStatus } from '../../hooks/useRequestLogs'

export function RequestStatusBadge({ status }: { status: number }) {
  const ok = isSuccessStatus(status)
  const code = status > 0 ? String(status) : '—'
  return (
    <Badge
      variant={ok ? 'success' : 'error'}
      icon={ok ? <CircleCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <CircleX className="w-3.5 h-3.5" aria-hidden="true" />}
      className="whitespace-nowrap"
    >
      {ok ? 'Success' : 'Error'} <span className="font-mono">{code}</span>
    </Badge>
  )
}

export function CacheHitBadge() {
  return (
    <Badge variant="info" icon={<Zap className="w-3.5 h-3.5" aria-hidden="true" />} className="whitespace-nowrap">
      Cache hit
    </Badge>
  )
}

