import type { MCPServerHealth } from '../../hooks/useMCPServerHealth'
import { relativeTime } from '../../components/ui/TimeAgo'
import { Tooltip } from '../../components/ui/Tooltip'
import { CircleCheck, CircleX, CircleAlert } from '../../components/ui/icons'

const healthConfig = {
  healthy: { Icon: CircleCheck, className: 'text-success', label: 'Healthy' },
  unhealthy: { Icon: CircleX, className: 'text-error', label: 'Unhealthy' },
  unknown: { Icon: CircleAlert, className: 'text-text-tertiary', label: 'Unknown' },
} as const

export function HealthIndicator({ health }: { health: MCPServerHealth | undefined }) {
  const { Icon, className, label } = healthConfig[health?.status ?? 'unknown']

  const details: string[] = []
  if (health?.last_check) {
    const ago = relativeTime(health.last_check)
    if (ago) details.push(`Last check: ${ago}`)
  }
  if (health && health.latency_ms > 0) details.push(`Latency: ${health.latency_ms}ms`)
  if (health && health.tool_count > 0) details.push(`Tools: ${health.tool_count}`)
  if (health?.last_error) details.push(`Error: ${health.last_error}`)

  const content = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" tabIndex={details.length ? 0 : undefined}>
      <Icon className={`w-4 h-4 shrink-0 ${className}`} aria-hidden="true" />
      <span className="text-sm text-text-secondary">{label}</span>
      {health?.status === 'healthy' && health.latency_ms > 0 && (
        <span className="text-xs tabular-nums text-text-tertiary">{health.latency_ms}ms</span>
      )}
    </span>
  )

  if (details.length === 0) return content
  return (
    <Tooltip
      content={
        <span className="block whitespace-pre-line break-words">{details.join('\n')}</span>
      }
    >
      {content}
    </Tooltip>
  )
}
