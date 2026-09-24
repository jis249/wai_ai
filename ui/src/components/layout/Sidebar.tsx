import { useMemo } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useMe } from '../../hooks/useMe'
import { LOCAL_STORAGE_KEY } from '../../lib/constants'
import { ThemeToggle } from '../ui/ThemeToggle'

function formatRole(role?: string): string {
  if (!role) return '...'
  return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
  locked?: boolean
  minRole?: string
  end?: boolean
  matchPrefixes?: string[]
}

interface NavGroup {
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

function hasMinRole(userRole: string, minRole?: string): boolean {
  if (!minRole) return true
  if (import.meta.env.DEV && !(userRole in roleLevel)) {
    console.warn(`[Sidebar] Unknown role "${userRole}" — defaulting to member visibility`)
  }
  return (roleLevel[userRole] ?? 0) >= (roleLevel[minRole] ?? 0)
}

const iconProps = {
  className: 'h-5 w-5 shrink-0',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconDashboard() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function IconTerminal() {
  return (
    <svg {...iconProps}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function IconKey() {
  return (
    <svg {...iconProps}>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg {...iconProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconBarChart() {
  return (
    <svg {...iconProps}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function IconCube() {
  return (
    <svg {...iconProps}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <line x1="9" y1="22" x2="9" y2="2" />
      <line x1="15" y1="22" x2="15" y2="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  )
}

function IconPersonPlus() {
  return (
    <svg {...iconProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  )
}

function IconPlug() {
  return (
    <svg {...iconProps}>
      <path d="M12 22v-5" />
      <path d="M9 7V2" />
      <path d="M15 7V2" />
      <path d="M6 7h12" />
      <path d="M6 7v4a6 6 0 0 0 12 0V7" />
    </svg>
  )
}

function IconServer() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 8h.01M7 17h.01M11 8h6M11 17h6" />
    </svg>
  )
}

function buildNavigation(userRole: string): NavGroup[] {
  const isMember = userRole === 'member'
  return [
    {
      label: 'Overview',
      items: isMember
        ? [{ label: 'Home', path: '/playground', icon: <IconTerminal /> }]
        : [
            { label: 'Dashboard', path: '/', icon: <IconDashboard /> },
            { label: 'Playground', path: '/playground', icon: <IconTerminal /> },
          ],
    },
    {
      label: 'Manage',
      items: [
        {
          label: 'API access',
          path: '/keys',
          icon: <IconKey />,
          matchPrefixes: ['/keys', '/service-accounts'],
        },
        { label: 'Models', path: '/models', icon: <IconCube />, end: false },
        { label: 'Teams', path: '/teams', icon: <IconUsers />, minRole: 'team_admin', end: false },
        { label: 'MCP', path: '/mcp', icon: <IconPlug />, end: false, matchPrefixes: ['/mcp'] },
      ],
    },
    {
      label: 'Analytics',
      items: [
        {
          label: 'Insights',
          path: '/usage',
          icon: <IconBarChart />,
          end: false,
          matchPrefixes: ['/usage'],
        },
      ],
    },
    {
      label: '',
      items: [
        { label: 'Organization', path: '/org', icon: <IconBuilding />, end: false },
      ],
    },
    {
      label: 'System',
      minRole: 'system_admin',
      items: [
        { label: 'Organizations', path: '/orgs', icon: <IconBuilding />, end: false },
        { label: 'Users', path: '/users', icon: <IconPersonPlus /> },
        {
          label: 'Platform',
          path: '/platform',
          icon: <IconServer />,
          end: false,
          matchPrefixes: ['/platform'],
        },
      ],
    },
  ]
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 shrink-0 opacity-50"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

export function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const { data } = useMe()
  const queryClient = useQueryClient()
  const location = useLocation()

  const userRole = data?.role ?? 'member'

  const visibleGroups = useMemo(() => {
    const navigation = buildNavigation(userRole)
    return navigation
      .filter(group => hasMinRole(userRole, group.minRole))
      .map(group => ({
        ...group,
        items: group.items.filter(item => hasMinRole(userRole, item.minRole)),
      }))
      .filter(group => group.items.length > 0)
  }, [userRole])

  return (
    <aside
      aria-label="Main navigation"
      className={`${collapsed ? 'w-[72px]' : 'w-[260px]'} bg-bg-secondary/95 border-r border-border flex flex-col fixed h-screen z-50 shadow-[var(--shadow-sidebar)] transition-[width] duration-200`}
    >
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border shrink-0 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 no-underline min-w-0">
          <img src="/logo.svg" alt="wai" className="h-7 w-7" />
          {!collapsed && <span className="gradient-text text-xl font-bold">wai</span>}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          className="text-text-tertiary hover:text-text-primary p-1 rounded-md"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-0.5 p-3 overflow-y-auto">
        {visibleGroups.map((group, groupIndex) => (
            <div key={group.label || `group-${groupIndex}`}>
              {groupIndex > 0 && (
                <div className="h-px bg-border my-2" />
              )}
              {group.label && !collapsed && (
                <div className="text-[11px] uppercase tracking-wider text-text-tertiary/50 px-3 mb-1 mt-1">
                  {group.label}
                </div>
              )}
              {group.items.map((item) =>
                item.locked ? (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm opacity-50 hover:opacity-70 transition-opacity"
                  >
                    {item.icon}
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {!collapsed && <LockIcon />}
                  </NavLink>
                ) : (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.end !== undefined ? item.end : item.path === '/'}
                    className={({ isActive }) => {
                      const prefixMatch = item.matchPrefixes?.some(
                        (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
                      )
                      const active = Boolean(prefixMatch) || isActive
                      return [
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm no-underline transition-all duration-200',
                        active
                          ? 'bg-accent/15 text-accent shadow-[inset_3px_0_0_var(--color-accent)]'
                          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                      ].join(' ')
                    }}
                    title={item.label}
                  >
                    {item.icon}
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                  </NavLink>
                )
              )}
            </div>
          ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
      <div className="shrink-0 border-t border-border p-3 space-y-3">
        <ThemeToggle compact />
        <div className="flex items-center justify-between">
          <Link
            to="/profile"
            className="text-xs text-text-secondary truncate max-w-[140px] hover:text-text-primary transition-colors no-underline"
            title="View profile"
          >
            {data?.display_name || data?.email || '...'}
          </Link>
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent uppercase">{formatRole(data?.role)}</span>
        </div>
        <div className="flex gap-2">
          <Link
            to="/profile"
            className="flex-1 py-1.5 bg-transparent border border-border rounded-md text-xs text-text-secondary cursor-pointer transition-colors duration-200 hover:border-accent/40 hover:text-text-primary text-center no-underline"
          >
            Profile
          </Link>
          <button
            onClick={() => {
              localStorage.removeItem(LOCAL_STORAGE_KEY)
              queryClient.clear()
              window.location.href = '/login'
            }}
            className="flex-1 py-1.5 bg-transparent border border-border rounded-md text-xs text-text-secondary cursor-pointer transition-colors duration-200 hover:border-error hover:text-error"
          >
            Logout
          </button>
        </div>
      </div>
      )}
    </aside>
  )
}
