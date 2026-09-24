import type { APIKeyResponse } from '../../hooks/useAPIKeys'

export const keyTypeBadgeVariant: Record<string, 'default' | 'info' | 'warning' | 'muted'> = {
  user_key: 'default',
  team_key: 'info',
  sa_key: 'warning',
  session_key: 'muted',
}

export const keyTypeLabels: Record<string, string> = {
  user_key: 'User',
  team_key: 'Team',
  sa_key: 'Service Acct',
  session_key: 'Session',
}

export const KEY_TYPE_OPTIONS = [
  { value: 'user_key', label: 'User Key' },
  { value: 'team_key', label: 'Team Key' },
  { value: 'sa_key', label: 'Service Account' },
] as const

export const EXPIRES_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'never', label: 'Never' },
]

export const EDIT_EXPIRES_OPTIONS = [
  { value: 'keep', label: 'Keep current' },
  { value: '30d', label: '30 days from now' },
  { value: '90d', label: '90 days from now' },
  { value: '1y', label: '1 year from now' },
  { value: 'never', label: 'Never' },
]

export function expiresAtFromOption(opt: string): string | undefined {
  const days: Record<string, number> = { '30d': 30, '90d': 90, '1y': 365 }
  if (opt === 'never' || !days[opt]) return undefined
  return new Date(Date.now() + days[opt] * 86400000).toISOString()
}

/** Parse an optional numeric limit field; blank or invalid → undefined. */
export function parseLimit(value: string): number | undefined {
  if (!value.trim()) return undefined
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}

export interface KeyLimitsValue {
  dailyTokenLimit: string
  monthlyTokenLimit: string
  requestsPerMinute: string
  requestsPerDay: string
}

export const EMPTY_LIMITS: KeyLimitsValue = {
  dailyTokenLimit: '',
  monthlyTokenLimit: '',
  requestsPerMinute: '',
  requestsPerDay: '',
}

/** Existing limits as form strings (0 = unlimited shows as blank). */
export function limitsFromKey(k: Pick<APIKeyResponse, 'daily_token_limit' | 'monthly_token_limit' | 'requests_per_minute' | 'requests_per_day'>): KeyLimitsValue {
  const s = (n: number) => (n > 0 ? String(n) : '')
  return {
    dailyTokenLimit: s(k.daily_token_limit),
    monthlyTokenLimit: s(k.monthly_token_limit),
    requestsPerMinute: s(k.requests_per_minute),
    requestsPerDay: s(k.requests_per_day),
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type KeyStatus = 'active' | 'expiring' | 'expired'
export type KeyStatusFilter = 'all' | KeyStatus

export const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function keyStatus(key: Pick<APIKeyResponse, 'expires_at'>, now: number): KeyStatus {
  if (!key.expires_at) return 'active'
  const exp = Date.parse(key.expires_at)
  if (Number.isNaN(exp)) return 'active'
  if (exp <= now) return 'expired'
  if (exp - now <= EXPIRING_WINDOW_MS) return 'expiring'
  return 'active'
}

export const keyStatusLabels: Record<KeyStatus, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
}

export const keyStatusBadgeVariant: Record<KeyStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'error',
}

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

export interface OwnerContext {
  meId?: string
  teamNames: Map<string, string>
  serviceAccountNames: Map<string, string>
}

/** Who the key belongs to, from data the page already has (the key list has no owner names). */
export function keyOwnerLabel(key: APIKeyResponse, ctx: OwnerContext): string {
  if (key.key_type === 'sa_key') {
    return (key.service_account_id && ctx.serviceAccountNames.get(key.service_account_id)) || 'Service account'
  }
  if (key.key_type === 'team_key') {
    return (key.team_id && ctx.teamNames.get(key.team_id)) || 'Team'
  }
  if (key.user_id && key.user_id === ctx.meId) return 'You'
  return key.user_id ? `User ${key.user_id.slice(0, 8)}` : 'Unknown'
}

// ---------------------------------------------------------------------------
// Filter + sort
// ---------------------------------------------------------------------------

export type KeySortColumn = 'name' | 'key_type' | 'owner' | 'status' | 'expires_at' | 'last_used_at' | 'created_at'

export interface KeySort {
  column: KeySortColumn
  direction: 'asc' | 'desc'
}

export function filterKeys(
  keys: APIKeyResponse[],
  opts: { query: string; status: KeyStatusFilter; now: number; owner: OwnerContext },
): APIKeyResponse[] {
  const q = opts.query.trim().toLowerCase()
  return keys.filter((k) => {
    if (opts.status !== 'all' && keyStatus(k, opts.now) !== opts.status) return false
    if (!q) return true
    return [k.name, k.key_hint, keyOwnerLabel(k, opts.owner)].some((v) => v?.toLowerCase().includes(q))
  })
}

const statusOrder: Record<KeyStatus, number> = { active: 0, expiring: 1, expired: 2 }

function timeValue(iso: string | null | undefined, missing: number): number {
  if (!iso) return missing
  const t = Date.parse(iso)
  return Number.isNaN(t) ? missing : t
}

export function sortKeys(keys: APIKeyResponse[], sort: KeySort | null, owner: OwnerContext, now: number): APIKeyResponse[] {
  if (!sort) return keys
  const dir = sort.direction === 'asc' ? 1 : -1
  const value = (k: APIKeyResponse): string | number => {
    switch (sort.column) {
      case 'name':
        return k.name.toLowerCase()
      case 'key_type':
        return keyTypeLabels[k.key_type] ?? k.key_type
      case 'owner':
        return keyOwnerLabel(k, owner).toLowerCase()
      case 'status':
        return statusOrder[keyStatus(k, now)]
      case 'expires_at':
        // "Never" sorts after every real date.
        return timeValue(k.expires_at, Number.MAX_SAFE_INTEGER)
      case 'last_used_at':
        // "Never used" sorts before every real date.
        return timeValue(k.last_used_at, 0)
      case 'created_at':
        return timeValue(k.created_at, 0)
    }
  }
  return [...keys].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
}

/** Toggle asc/desc on the same column; a new column starts ascending (dates start newest-first). */
export function nextSort(current: KeySort | null, column: KeySortColumn): KeySort {
  if (current?.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  const dateColumn = column === 'created_at' || column === 'last_used_at'
  return { column, direction: dateColumn ? 'desc' : 'asc' }
}

// ---------------------------------------------------------------------------
// Permissions (UI hints only; the API is authoritative)
// ---------------------------------------------------------------------------

export interface KeyActions {
  canEdit: boolean
  canRotate: boolean
  canRevoke: boolean
}

export function keyActions(key: APIKeyResponse, opts: { meId?: string; canManageAnyKey: boolean }): KeyActions {
  const isSessionKey = key.key_type === 'session_key'
  const isOwnKey = !!key.user_id && key.user_id === opts.meId
  if (isSessionKey) {
    return { canEdit: opts.canManageAnyKey, canRotate: false, canRevoke: opts.canManageAnyKey }
  }
  const canManage = opts.canManageAnyKey || isOwnKey
  return { canEdit: canManage, canRotate: canManage, canRevoke: canManage }
}
