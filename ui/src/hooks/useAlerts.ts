import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

/** Alert scope: an org id, or '' for the platform scope (system admins). */
export type AlertScope = string

export type AlertChannelKind = 'teams' | 'slack' | 'webhook'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertRuleKind =
  | 'budget.threshold'
  | 'error_rate.high'
  | 'model.health'
  | 'deployment.circuit'
  | 'pricing.sync'
  | 'digest.daily'

export interface AlertChannel {
  id: string
  org_id: string | null
  name: string
  kind: AlertChannelKind
  /** Host plus masked path; the full URL is write-only. */
  url_hint: string
  has_secret: boolean
  enabled: boolean
  created_by: string
  created_at: string
  updated_at: string
  /** Webhook signing secret, returned only on create / rotate. */
  signing_secret?: string | null
}

export interface AlertRule {
  kind: AlertRuleKind
  org_id: string | null
  enabled: boolean
  severity_min: AlertSeverity
  cooldown_seconds: number
  params: Record<string, unknown>
  channel_ids: string[]
  updated_at: string
}

export interface AlertDelivery {
  channel_id: string
  name: string
  kind: string
  ok: boolean
  status: number
  error: string
  attempts: number
}

export interface AlertEventItem {
  id: string
  org_id: string | null
  kind: string
  severity: AlertSeverity
  title: string
  message: string
  data: Record<string, unknown>
  created_at: string
  delivery: AlertDelivery[]
}

export interface AlertEventPage {
  data: AlertEventItem[]
  has_more: boolean
  next_cursor?: string | null
}

export interface AlertTestResult {
  ok: boolean
  status: number
  error: string
  attempts: number
  ms: number
  event_id: string
}

export interface CreateAlertChannelParams {
  name: string
  kind: AlertChannelKind
  url: string
  enabled?: boolean
}

export interface UpdateAlertChannelParams {
  name?: string
  url?: string
  enabled?: boolean
  rotate_secret?: boolean
}

export interface UpdateAlertRuleParams {
  enabled?: boolean
  severity_min?: AlertSeverity
  cooldown_seconds?: number
  params?: Record<string, unknown>
  channel_ids?: string[]
}

export interface AlertEventFilters {
  kind?: string
  severity?: string
  cursor?: string
}

function scopeQuery(scope: AlertScope, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams()
  if (scope) q.set('org_id', scope)
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : ''
}

const keys = {
  channels: (scope: AlertScope) => ['alerts', 'channels', scope] as const,
  rules: (scope: AlertScope) => ['alerts', 'rules', scope] as const,
  events: (scope: AlertScope) => ['alerts', 'events', scope] as const,
}

export function useAlertChannels(scope: AlertScope, enabled = true) {
  return useQuery({
    queryKey: keys.channels(scope),
    queryFn: () => apiClient<{ data: AlertChannel[] }>(`/alerts/channels${scopeQuery(scope)}`),
    enabled,
  })
}

export function useCreateAlertChannel(scope: AlertScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: CreateAlertChannelParams) =>
      apiClient<AlertChannel>('/alerts/channels', {
        method: 'POST',
        body: JSON.stringify({ ...params, org_id: scope || null }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.channels(scope) }),
  })
}

export function useUpdateAlertChannel(scope: AlertScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateAlertChannelParams }) =>
      apiClient<AlertChannel>(`/alerts/channels/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.channels(scope) }),
  })
}

export function useDeleteAlertChannel(scope: AlertScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient<void>(`/alerts/channels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.channels(scope) })
      void qc.invalidateQueries({ queryKey: keys.rules(scope) })
    },
  })
}

export function useTestAlertChannel(scope: AlertScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<AlertTestResult>(`/alerts/channels/${encodeURIComponent(id)}/test`, { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.events(scope) }),
  })
}

export function useAlertRules(scope: AlertScope, enabled = true) {
  return useQuery({
    queryKey: keys.rules(scope),
    queryFn: () => apiClient<{ data: AlertRule[] }>(`/alerts/rules${scopeQuery(scope)}`),
    enabled,
  })
}

export function useUpdateAlertRule(scope: AlertScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, params }: { kind: AlertRuleKind; params: UpdateAlertRuleParams }) =>
      apiClient<AlertRule>(`/alerts/rules/${encodeURIComponent(kind)}${scopeQuery(scope)}`, {
        method: 'PUT',
        body: JSON.stringify(params),
      }),
    onSuccess: (rule) => {
      qc.setQueryData<{ data: AlertRule[] }>(keys.rules(scope), (prev) =>
        prev ? { data: prev.data.map((r) => (r.kind === rule.kind ? rule : r)) } : prev,
      )
    },
  })
}

export function useAlertEvents(scope: AlertScope, filters: AlertEventFilters = {}, enabled = true) {
  return useQuery({
    queryKey: [...keys.events(scope), filters],
    queryFn: () =>
      apiClient<AlertEventPage>(
        `/alerts/events${scopeQuery(scope, { kind: filters.kind, severity: filters.severity, cursor: filters.cursor, limit: '25' })}`,
      ),
    enabled,
    refetchInterval: 60_000,
  })
}

/** Organization picker options for system admins (first 100 orgs). */
export function useAlertOrgOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['alerts', 'org-options'],
    queryFn: () => apiClient<{ data: { id: string; name: string }[] }>('/orgs?limit=100'),
    enabled,
    staleTime: 5 * 60_000,
  })
}
