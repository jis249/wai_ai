import type { MCPServerResponse } from '../../hooks/useMCPServers'
import type { MCPServerHealth } from '../../hooks/useMCPServerHealth'
import type { Permissions } from '../../hooks/usePermissions'
import { mcpServerEndpoint } from './mcpUrl'

export const AUTH_TYPE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'header', label: 'Custom Header' },
  { value: 'oauth', label: 'OAuth (Client Credentials)' },
] as const

export function authBadgeVariant(authType: string): 'muted' | 'default' | 'info' {
  if (authType === 'none') return 'muted'
  if (authType === 'bearer') return 'default'
  return 'info'
}

export function authLabel(authType: string): string {
  if (authType === 'none') return 'None'
  if (authType === 'bearer') return 'Bearer'
  if (authType === 'header') return 'Header'
  if (authType === 'oauth') return 'OAuth'
  return authType
}

export function scopeBadgeVariant(scope: string): 'default' | 'info' | 'success' {
  if (scope === 'global') return 'default'
  if (scope === 'org') return 'info'
  return 'success'
}

export function scopeLabel(scope: string): string {
  if (scope === 'global') return 'Global'
  if (scope === 'org') return 'Org'
  if (scope === 'team') return 'Team'
  return scope
}

export function sourceBadgeVariant(source: string): 'default' | 'muted' | 'warning' {
  if (source === 'yaml') return 'warning'
  if (source === 'builtin') return 'default'
  return 'muted'
}

export function sourceLabel(source: string): string {
  if (source === 'yaml') return 'YAML'
  if (source === 'builtin') return 'Built-in'
  return 'API'
}

/** URL shown in the table: the upstream URL, or the WAI endpoint for built-in servers. */
export function getMCPServerDisplayUrl(server: Pick<MCPServerResponse, 'url' | 'source' | 'alias'>): string {
  if (server.url) return server.url
  if (server.source === 'builtin') return mcpServerEndpoint(server.alias)
  return ''
}

// ---------------------------------------------------------------------------
// Permissions — mirrors backend `_get_authorized_server(write=True)`:
// global servers → system admins only; org/team servers → admins of that org,
// or (team servers) team admins.
// ---------------------------------------------------------------------------

type PermFlags = Pick<Permissions, 'isSystemAdmin' | 'isOrgAdmin' | 'isTeamAdmin'>

/** Whether the user may write this server (edit, toggle, blocklist). Ignores source. */
export function canWriteServer(
  server: Pick<MCPServerResponse, 'scope' | 'org_id' | 'team_id'>,
  perms: PermFlags,
  myOrgId: string | undefined,
): boolean {
  if (perms.isSystemAdmin) return true
  const isGlobal = server.scope === 'global' || (!server.org_id && !server.team_id)
  if (isGlobal) return false
  if (server.org_id && myOrgId && server.org_id !== myOrgId) return false
  if (perms.isOrgAdmin) return true
  return server.scope === 'team' && perms.isTeamAdmin
}

/** Config edits (name/URL/auth/delete/activate) are not possible for yaml or built-in servers. */
export function isConfigManaged(server: Pick<MCPServerResponse, 'source'>): boolean {
  return server.source === 'yaml' || server.source === 'builtin'
}

// ---------------------------------------------------------------------------
// Search + sort
// ---------------------------------------------------------------------------

export type ServerSortColumn = 'name' | 'alias' | 'url' | 'scope' | 'tools' | 'is_active' | 'health'
export interface ServerSort {
  column: ServerSortColumn
  direction: 'asc' | 'desc'
}

export function filterServers<T extends Pick<MCPServerResponse, 'name' | 'alias' | 'url' | 'source'>>(
  servers: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return servers
  return servers.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.alias.toLowerCase().includes(q) ||
      getMCPServerDisplayUrl(s).toLowerCase().includes(q),
  )
}

const HEALTH_RANK: Record<string, number> = { healthy: 0, unknown: 1, unhealthy: 2 }

export function sortServers(
  servers: MCPServerResponse[],
  sort: ServerSort | null,
  health: Map<string, MCPServerHealth>,
): MCPServerResponse[] {
  if (!sort) return servers
  const dir = sort.direction === 'asc' ? 1 : -1
  const key = (s: MCPServerResponse): string | number => {
    switch (sort.column) {
      case 'name':
        return s.name.toLowerCase()
      case 'alias':
        return s.alias.toLowerCase()
      case 'url':
        return getMCPServerDisplayUrl(s).toLowerCase()
      case 'scope':
        return s.scope
      case 'tools':
        return health.get(s.id)?.tool_count ?? -1
      case 'is_active':
        return s.is_active ? 0 : 1
      case 'health':
        return HEALTH_RANK[health.get(s.id)?.status ?? 'unknown'] ?? 1
    }
  }
  return [...servers].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka < kb) return -dir
    if (ka > kb) return dir
    return 0
  })
}

export function nextSort(current: ServerSort | null, column: ServerSortColumn): ServerSort | null {
  if (!current || current.column !== column) return { column, direction: 'asc' }
  if (current.direction === 'asc') return { column, direction: 'desc' }
  return null
}
