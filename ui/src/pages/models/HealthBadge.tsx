import type { ModelHealthInfo } from '../../hooks/useModelHealth'
import { CircleCheck, CircleX, TriangleAlert, CircleAlert } from '../../components/ui/icons'
import type { LucideIcon } from '../../components/ui/icons'
import { cn } from '../../lib/utils'

const healthConfig: Record<ModelHealthInfo['status'], { Icon: LucideIcon; className: string; label: string }> = {
  healthy: { Icon: CircleCheck, className: 'text-success', label: 'Healthy' },
  degraded: { Icon: TriangleAlert, className: 'text-warning', label: 'Degraded' },
  unhealthy: { Icon: CircleX, className: 'text-error', label: 'Unhealthy' },
  unknown: { Icon: CircleAlert, className: 'text-text-tertiary', label: 'Unknown' },
}

/** Health status as icon + text (never color alone), with optional latency. */
export function HealthBadge({ info }: { info: ModelHealthInfo | undefined }) {
  const status = info?.status ?? 'unknown'
  const { Icon, className, label } = healthConfig[status] ?? healthConfig.unknown

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={cn('text-sm', info === undefined ? 'text-text-tertiary' : 'text-text-secondary')}>
          {label}
        </span>
      </span>
      {info !== undefined && info.latency_ms > 0 && (
        <span className="text-text-tertiary text-xs tabular-nums">{info.latency_ms}ms</span>
      )}
    </span>
  )
}
