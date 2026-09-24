import type { AlertChannelKind, AlertRuleKind, AlertSeverity } from '../../hooks/useAlerts'

export const CHANNEL_KIND_LABEL: Record<AlertChannelKind, string> = {
  teams: 'Microsoft Teams',
  slack: 'Slack',
  webhook: 'Webhook',
}

export const CHANNEL_KIND_HELP: Record<AlertChannelKind, string> = {
  teams:
    'Use a Teams Workflows URL ("Post to a channel when a webhook request is received") or a legacy incoming webhook URL. Alerts arrive as Adaptive Cards.',
  slack: 'Use a Slack incoming webhook URL (https://hooks.slack.com/services/...). Alerts use Block Kit.',
  webhook:
    'WAI POSTs JSON to this URL, signed with HMAC-SHA256 in the X-WAI-Signature header (sha256=<hex>) and timestamped with X-WAI-Timestamp.',
}

export const CHANNEL_URL_PLACEHOLDER: Record<AlertChannelKind, string> = {
  teams: 'https://…logic.azure.com/workflows/…',
  slack: 'https://hooks.slack.com/services/…',
  webhook: 'https://example.com/hooks/wai',
}

export interface RuleMeta {
  label: string
  description: string
}

export const RULE_META: Record<AlertRuleKind, RuleMeta> = {
  'budget.threshold': {
    label: 'Budget thresholds',
    description:
      'Warns when an organization, team or API key with a monthly spend limit reaches a percentage of it (UTC calendar month). Each threshold alerts at most once per month; 100% and above is critical.',
  },
  'error_rate.high': {
    label: 'High error rate',
    description:
      'Checked every 5 minutes: alerts when at least the minimum number of requests ran in the window and the share of non-2xx responses reaches the threshold.',
  },
  'model.health': {
    label: 'Model health',
    description: 'Alerts when a model health probe changes to unhealthy or recovers.',
  },
  'deployment.circuit': {
    label: 'Deployment circuit breaker',
    description: 'Alerts when a model deployment circuit opens after repeated failures, and when it closes again.',
  },
  'pricing.sync': {
    label: 'Pricing sync',
    description: 'Automatic model pricing sync failed. Model prices (and cost reports) may be stale until it succeeds.',
  },
  'digest.daily': {
    label: 'Daily digest',
    description:
      'A daily summary of the last 24 hours: requests, spend, errors and top models. Sent once a day at the chosen UTC time (03:30 UTC is 09:00 IST).',
  },
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

export const SEVERITY_VARIANT: Record<AlertSeverity, 'info' | 'warning' | 'error'> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
}

export const KIND_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(RULE_META).map(([k, v]) => [k, v.label])),
  test: 'Test',
}

export const COOLDOWN_OPTIONS = [
  { value: '0', label: 'No cooldown' },
  { value: '300', label: '5 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '21600', label: '6 hours' },
  { value: '86400', label: '1 day' },
]

export function cooldownLabel(seconds: number): string {
  const opt = COOLDOWN_OPTIONS.find((o) => Number(o.value) === seconds)
  if (opt) return opt.label
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`
  if (seconds % 60 === 0) return `${seconds / 60} minutes`
  return `${seconds} seconds`
}
