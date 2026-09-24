import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useMe } from '../../hooks/useMe'
import { useTheme } from '../../hooks/useTheme'
import apiClient from '../../api/client'
import { LOCAL_STORAGE_KEY } from '../../lib/constants'
import { cn } from '../../lib/utils'
import { ThemeToggle } from '../ui/ThemeToggle'
import { IconButton } from '../ui/IconButton'
import { Tooltip } from '../ui/Tooltip'
import {
  Box,
  Building2,
  ChartColumn,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Server,
  Sun,
  Terminal,
  User,
  UserPlus,
  Users,
  X,
} from '../ui/icons'

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

const navIconProps = { className: 'h-5 w-5 shrink-0', strokeWidth: 1.75, 'aria-hidden': true } as const

function buildNavigation(userRole: string): NavGroup[] {
  const isMember = userRole === 'member'
  return [
    {
      label: 'Overview',
      items: isMember
        ? [{ label: 'Home', path: '/playground', icon: <Terminal {...navIconProps} /> }]
        : [
            { label: 'Dashboard', path: '/', icon: <LayoutDashboard {...navIconProps} /> },
            { label: 'Playground', path: '/playground', icon: <Terminal {...navIconProps} /> },
          ],
    },
    {
      label: 'Manage',
      items: [
        {
          label: 'API access',
          path: '/keys',
          icon: <KeyRound {...navIconProps} />,
          matchPrefixes: ['/keys', '/service-accounts'],
        },
        { label: 'Models', path: '/models', icon: <Box {...navIconProps} />, end: false },
        { label: 'Teams', path: '/teams', icon: <Users {...navIconProps} />, minRole: 'team_admin', end: false },
        { label: 'MCP', path: '/mcp', icon: <Plug {...navIconProps} />, end: false, matchPrefixes: ['/mcp'] },
      ],
    },
    {
      label: 'Analytics',
      items: [
        {
          label: 'Insights',
          path: '/usage',
          icon: <ChartColumn {...navIconProps} />,
          end: false,
          matchPrefixes: ['/usage'],
        },
      ],
    },
    {
      label: '',
      items: [
        { label: 'Organization', path: '/org', icon: <Building2 {...navIconProps} />, end: false },
      ],
    },
    {
      label: 'System',
      minRole: 'system_admin',
      items: [
        { label: 'Organizations', path: '/orgs', icon: <Building2 {...navIconProps} />, end: false },
        { label: 'Users', path: '/users', icon: <UserPlus {...navIconProps} /> },
        {
          label: 'Platform',
          path: '/platform',
          icon: <Server {...navIconProps} />,
          end: false,
          matchPrefixes: ['/platform'],
        },
      ],
    },
  ]
}

function isItemActive(item: NavItem, pathname: string): boolean {
  const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  if (item.matchPrefixes?.some(matches)) return true
  const end = item.end !== undefined ? item.end : item.path === '/'
  return end ? pathname === item.path : matches(item.path)
}

export interface SidebarProps {
  /** Icon-only rail (desktop only). */
  collapsed?: boolean
  /** Desktop collapse/expand toggle. */
  onToggle?: () => void
  /**
   * `desktop` (default): fixed left rail. `drawer`: fills its off-canvas container,
   * never collapsed, and shows a close button instead of the collapse toggle.
   */
  variant?: 'desktop' | 'drawer'
  /** Drawer only: close request from the close button. */
  onClose?: () => void
  /** Called when any link in the sidebar is activated (the drawer closes itself). */
  onNavigate?: () => void
}

export function Sidebar({
  collapsed: collapsedProp = false,
  onToggle,
  variant = 'desktop',
  onClose,
  onNavigate,
}: SidebarProps) {
  const { data } = useMe()
  const queryClient = useQueryClient()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  const isDrawer = variant === 'drawer'
  const collapsed = !isDrawer && collapsedProp
  const userRole = data?.role ?? 'member'
  const userName = data?.display_name || data?.email || '...'
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

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

  async function handleLogout() {
    // Revoke the session server-side; ignore failures so logout always completes.
    await apiClient<void>('/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem(LOCAL_STORAGE_KEY)
    queryClient.clear()
    window.location.href = '/login'
  }

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'bg-bg-secondary/95 border-r border-border flex flex-col',
        isDrawer
          ? 'h-full w-full'
          : cn(
              'fixed h-screen z-50 shadow-[var(--shadow-sidebar)] transition-[width] duration-200',
              collapsed ? 'w-[72px]' : 'w-[260px]',
            ),
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'py-4 border-b border-border shrink-0 flex items-center gap-2',
          collapsed ? 'flex-col px-2' : 'justify-between px-4',
        )}
      >
        <Link to="/" onClick={onNavigate} aria-label="wai home" className="flex items-center gap-2 no-underline min-w-0">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          {!collapsed && <span className="gradient-text text-xl font-bold">wai</span>}
        </Link>
        {isDrawer ? (
          <IconButton aria-label="Close navigation" icon={<X />} onClick={onClose} tooltip={false} />
        ) : (
          <IconButton
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            onClick={onToggle}
            tooltipSide="right"
          />
        )}
      </div>

      {/* Navigation */}
      <nav className={cn('flex-1 flex flex-col gap-0.5 overflow-y-auto', collapsed ? 'p-2' : 'p-3')}>
        {visibleGroups.map((group, groupIndex) => (
          <div key={group.label || `group-${groupIndex}`} className="flex flex-col gap-0.5">
            {groupIndex > 0 && <div className="h-px bg-border my-2" aria-hidden="true" />}
            {group.label && !collapsed && (
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-3 mb-1 mt-1">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const active = !item.locked && isItemActive(item, location.pathname)
              const link = (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 py-2 rounded-lg text-sm no-underline transition-all duration-200',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    item.locked
                      ? 'text-text-secondary opacity-50 hover:opacity-70'
                      : active
                        ? 'bg-accent/15 text-accent shadow-[inset_3px_0_0_var(--color-accent)]'
                        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                  )}
                >
                  {item.icon}
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {!collapsed && item.locked && <Lock className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />}
                </Link>
              )
              return collapsed ? (
                <Tooltip key={item.path} content={item.label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      {collapsed ? (
        <div className="shrink-0 border-t border-border p-2 flex flex-col items-center gap-1">
          <IconButton
            aria-label={`Switch to ${nextTheme} theme`}
            icon={theme === 'dark' ? <Sun /> : <Moon />}
            onClick={toggleTheme}
            tooltipSide="right"
          />
          <Tooltip content={`Profile (${userName})`} side="right">
            <Link
              to="/profile"
              onClick={onNavigate}
              aria-label="Profile"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary no-underline transition-colors hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <User className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
          </Tooltip>
          <IconButton
            aria-label="Logout"
            icon={<LogOut />}
            variant="destructive"
            onClick={handleLogout}
            tooltipSide="right"
          />
        </div>
      ) : (
        <div className="shrink-0 border-t border-border p-3 space-y-3">
          <ThemeToggle compact />
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/profile"
              onClick={onNavigate}
              className="min-w-0 text-xs text-text-secondary truncate hover:text-text-primary transition-colors no-underline"
            >
              {userName}
            </Link>
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent uppercase">
              {formatRole(data?.role)}
            </span>
          </div>
          <div className="flex gap-2">
            <Link
              to="/profile"
              onClick={onNavigate}
              className="flex-1 py-1.5 bg-transparent border border-border rounded-md text-xs text-text-secondary cursor-pointer transition-colors duration-200 hover:border-accent/40 hover:text-text-primary text-center no-underline"
            >
              Profile
            </Link>
            <button
              type="button"
              onClick={handleLogout}
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
