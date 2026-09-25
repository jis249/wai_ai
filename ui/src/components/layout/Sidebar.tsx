import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMe } from '../../hooks/useMe'
import { useTheme } from '../../hooks/useTheme'
import { isMac } from '../../hooks/useHotkeys'
import { cn } from '../../lib/utils'
import { ThemeToggle } from '../ui/ThemeToggle'
import { IconButton } from '../ui/IconButton'
import { Tooltip } from '../ui/Tooltip'
import { useCommandCenter } from '../command/context'
import { useLogout } from '../command/useLogout'
import { Kbd } from '../command/Kbd'
import { isItemActive, visibleNavigation } from './navigation'
import { OrgSwitcher } from './OrgSwitcher'
import {
  Lock,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  User,
  X,
} from '../ui/icons'

function formatRole(role?: string): string {
  if (!role) return '...'
  return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const navIconProps = { className: 'h-5 w-5 shrink-0', strokeWidth: 1.75, 'aria-hidden': true } as const

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
  const commandCenter = useCommandCenter()
  const handleLogout = useLogout()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  const isDrawer = variant === 'drawer'
  const collapsed = !isDrawer && collapsedProp
  const userRole = data?.role ?? 'member'
  const userName = data?.display_name || data?.email || '...'
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  const visibleGroups = useMemo(() => visibleNavigation(userRole), [userRole])
  const showSearch = !isDrawer && commandCenter !== null

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

      {showSearch && (
        <div className={cn('shrink-0 pt-3', collapsed ? 'flex justify-center px-2' : 'px-3')}>
          {collapsed ? (
            <IconButton
              aria-label="Search"
              aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
              icon={<Search />}
              onClick={commandCenter.openPalette}
              tooltip={<span className="inline-flex items-center gap-2">Search <Kbd keys="mod+k" /></span>}
              tooltipSide="right"
            />
          ) : (
            <button
              type="button"
              onClick={commandCenter.openPalette}
              aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-bg-primary/40 px-3 py-1.5 text-sm text-text-tertiary transition-colors hover:border-accent/40 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left">Search…</span>
              <Kbd keys="mod+k" />
            </button>
          )}
        </div>
      )}

      {!collapsed && data?.is_system_admin && (
        <div className="shrink-0 px-3 pt-3">
          <OrgSwitcher />
        </div>
      )}

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
                  <item.icon {...navIconProps} />
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
