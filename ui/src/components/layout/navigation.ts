/**
 * Single source of truth for the app's navigable pages. The Sidebar renders the
 * grouped `buildNavigation` tree; the command palette lists those items plus the
 * role-gated sub-pages from `SUB_PAGES`. Both apply the same `hasMinRole` gating.
 */
import {
  Box,
  Building2,
  ChartColumn,
  KeyRound,
  LayoutDashboard,
  Plug,
  Server,
  Terminal,
  UserPlus,
  Users,
  Workflow,
  ScrollText,
  Settings,
  User,
  Shield,
  History,
  Route,
  Gauge,
  DollarSign,
  Bot,
  Layers,
  Bell,
  type LucideIcon,
} from '../ui/icons'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  locked?: boolean
  minRole?: string
  end?: boolean
  matchPrefixes?: string[]
  /** Extra search terms for the command palette. */
  keywords?: string[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
  minRole?: string
}

const roleLevel: Record<string, number> = {
  member: 0,
  team_admin: 1,
  org_admin: 2,
  system_admin: 3,
}

export function hasMinRole(userRole: string, minRole?: string): boolean {
  if (!minRole) return true
  if (import.meta.env.DEV && !(userRole in roleLevel)) {
    console.warn(`[navigation] Unknown role "${userRole}" — defaulting to member visibility`)
  }
  return (roleLevel[userRole] ?? 0) >= (roleLevel[minRole] ?? 0)
}

const CONNECT_EDITOR_ITEM: NavItem = {
  label: 'Connect editor',
  path: '/integrations',
  icon: Workflow,
  keywords: ['cursor', 'vs code', 'vscode', 'copilot', 'continue', 'cline', 'claude code', 'integration', 'setup'],
}

export function buildNavigation(userRole: string): NavGroup[] {
  const isMember = userRole === 'member'
  return [
    {
      label: 'Overview',
      items: isMember
        ? [
            { label: 'Home', path: '/playground', icon: Terminal, keywords: ['playground', 'chat'] },
            CONNECT_EDITOR_ITEM,
          ]
        : [
            { label: 'Dashboard', path: '/', icon: LayoutDashboard, keywords: ['home', 'overview'] },
            { label: 'Playground', path: '/playground', icon: Terminal, keywords: ['chat', 'try'] },
            CONNECT_EDITOR_ITEM,
          ],
    },
    {
      label: 'Manage',
      items: [
        {
          label: 'API access',
          path: '/keys',
          icon: KeyRound,
          matchPrefixes: ['/keys', '/service-accounts'],
          keywords: ['keys', 'api keys', 'tokens'],
        },
        { label: 'Models', path: '/models', icon: Box, end: false, keywords: ['catalog', 'llm'] },
        { label: 'Teams', path: '/teams', icon: Users, minRole: 'team_admin', end: false },
        { label: 'MCP', path: '/mcp', icon: Plug, end: false, matchPrefixes: ['/mcp'], keywords: ['servers', 'tools'] },
      ],
    },
    {
      label: 'Analytics',
      items: [
        {
          label: 'Insights',
          path: '/usage',
          icon: ChartColumn,
          end: false,
          matchPrefixes: ['/usage'],
          keywords: ['usage', 'analytics', 'metrics'],
        },
      ],
    },
    {
      label: '',
      items: [
        { label: 'Organization', path: '/org', icon: Building2, end: false, keywords: ['org'] },
        {
          label: 'Alerts',
          path: '/alerts',
          icon: Bell,
          minRole: 'org_admin',
          keywords: ['notifications', 'teams', 'slack', 'webhook', 'budget'],
        },
      ],
    },
    {
      label: 'System',
      minRole: 'system_admin',
      items: [
        { label: 'Organizations', path: '/orgs', icon: Building2, end: false, keywords: ['tenants'] },
        { label: 'Users', path: '/users', icon: UserPlus },
        {
          label: 'Platform',
          path: '/platform',
          icon: Server,
          end: false,
          matchPrefixes: ['/platform'],
          keywords: ['system', 'setup'],
        },
      ],
    },
  ]
}

/** Nav groups filtered to what `userRole` may see (empty groups dropped). */
export function visibleNavigation(userRole: string): NavGroup[] {
  return buildNavigation(userRole)
    .filter((group) => hasMinRole(userRole, group.minRole))
    .map((group) => ({ ...group, items: group.items.filter((item) => hasMinRole(userRole, item.minRole)) }))
    .filter((group) => group.items.length > 0)
}

/** Sub-pages (layout tabs) not shown in the sidebar, gated like their layouts. */
export const SUB_PAGES: NavItem[] = [
  { label: 'Service accounts', path: '/service-accounts', icon: KeyRound, minRole: 'org_admin' },
  { label: 'Model org access', path: '/models/org-access', icon: Box, minRole: 'org_admin' },
  { label: 'Model team access', path: '/models/team-access', icon: Box, minRole: 'team_admin' },
  { label: 'MCP org access', path: '/mcp/org-access', icon: Plug, minRole: 'org_admin' },
  { label: 'MCP team access', path: '/mcp/team-access', icon: Plug, minRole: 'team_admin' },
  { label: 'LLM usage', path: '/usage/llm', icon: ChartColumn },
  { label: 'MCP usage', path: '/usage/mcp', icon: ChartColumn },
  { label: 'Auto routing usage', path: '/usage/auto', icon: Bot },
  { label: 'Cost reports', path: '/usage/cost', icon: DollarSign, keywords: ['spend', 'billing'] },
  { label: 'Request logs', path: '/usage/logs', icon: ScrollText, keywords: ['requests', 'logs'] },
  { label: 'Organization members', path: '/org/users', icon: Users, minRole: 'org_admin', keywords: ['invite'] },
  { label: 'Organization settings', path: '/org/settings', icon: Settings, keywords: ['settings'] },
  { label: 'SSO', path: '/org/sso', icon: Shield, minRole: 'org_admin', keywords: ['single sign-on', 'saml', 'oidc'] },
  { label: 'Audit log', path: '/org/audit', icon: History, minRole: 'org_admin' },
  { label: 'Platform setup', path: '/platform/setup', icon: Layers, minRole: 'system_admin' },
  { label: 'Host metrics', path: '/platform/host', icon: Gauge, minRole: 'system_admin' },
  { label: 'Auto routing', path: '/platform/auto-routing', icon: Route, minRole: 'system_admin' },
  { label: 'Profile', path: '/profile', icon: User, keywords: ['account', 'me'] },
]

/** Every page `userRole` may open: sidebar items first, then sub-pages (deduplicated by path). */
export function accessiblePages(userRole: string): NavItem[] {
  const seen = new Set<string>()
  const out: NavItem[] = []
  for (const item of [
    ...visibleNavigation(userRole).flatMap((g) => g.items),
    ...SUB_PAGES.filter((p) => hasMinRole(userRole, p.minRole)),
  ]) {
    if (item.locked || seen.has(item.path)) continue
    seen.add(item.path)
    out.push(item)
  }
  return out
}

export function isItemActive(item: NavItem, pathname: string): boolean {
  const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  if (item.matchPrefixes?.some(matches)) return true
  const end = item.end !== undefined ? item.end : item.path === '/'
  return end ? pathname === item.path : matches(item.path)
}
