import { useMemo, useState } from 'react'
import type React from 'react'
import ReactDOM from 'react-dom'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import { useModalBehavior } from '../ui/useModalBehavior'
import { useTheme } from '../../hooks/useTheme'
import { accessiblePages, hasMinRole, type NavItem } from '../layout/navigation'
import { shortcutForPath, shortcutKeys } from './shortcuts'
import { Kbd } from './Kbd'
import { useLogout } from './useLogout'
import {
  Clock,
  Keyboard,
  KeyRound,
  LogOut,
  Moon,
  Plus,
  Plug,
  ScrollText,
  Search,
  Sun,
  Terminal,
  type LucideIcon,
} from '../ui/icons'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function looksLikeRequestId(value: string): boolean {
  return UUID_RE.test(value.trim())
}

interface PaletteAction {
  id: string
  label: string
  icon: LucideIcon
  keywords?: string[]
  shortcut?: string
  minRole?: string
  run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Role used for gating (same source as the Sidebar). */
  role: string
  recentPaths: string[]
  onShowShortcuts: () => void
}

const itemClass =
  'flex cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2 text-sm text-text-secondary outline-none data-[selected=true]:bg-accent/15 data-[selected=true]:text-text-primary data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'

const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-tertiary'

function ItemBody({ icon: Icon, label, shortcut }: { icon: LucideIcon; label: string; shortcut?: string }) {
  return (
    <>
      <Icon className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </>
  )
}

export function CommandPalette({ open, onClose, role, recentPaths, onShowShortcuts }: CommandPaletteProps) {
  const { panelRef, handlePanelKeyDown } = useModalBehavior({ open, onClose })
  if (!open) return null
  return ReactDOM.createPortal(
    <div
      className="dialog-overlay fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="command-palette-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="dialog-panel w-full max-w-xl overflow-hidden rounded-xl border border-border shadow-2xl backdrop-blur-xl"
        onKeyDown={handlePanelKeyDown}
      >
        <PaletteContent onClose={onClose} role={role} recentPaths={recentPaths} onShowShortcuts={onShowShortcuts} />
      </div>
    </div>,
    document.body,
  )
}

function PaletteContent({ onClose, role, recentPaths, onShowShortcuts }: Omit<CommandPaletteProps, 'open'>) {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const logout = useLogout()
  const [search, setSearch] = useState('')

  const pages = useMemo(() => accessiblePages(role), [role])
  const pageByPath = useMemo(() => new Map(pages.map((p) => [p.path, p])), [pages])
  const recent = useMemo(
    () => recentPaths.map((p) => pageByPath.get(p)).filter((p): p is NavItem => !!p),
    [recentPaths, pageByPath],
  )

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const actions: PaletteAction[] = [
    { id: 'new-key', label: 'Create API key', icon: KeyRound, keywords: ['new key', 'token'], run: () => go('/keys?new=1') },
    { id: 'new-model', label: 'Add model', icon: Plus, keywords: ['new model', 'provider'], minRole: 'system_admin', run: () => go('/models?new=1') },
    { id: 'new-mcp', label: 'Add MCP server', icon: Plug, keywords: ['new server', 'tools'], minRole: 'team_admin', run: () => go('/mcp?new=1') },
    { id: 'playground', label: 'Open playground', icon: Terminal, keywords: ['chat'], shortcut: shortcutForPath('/playground'), run: () => go('/playground') },
    {
      id: 'theme',
      label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      icon: theme === 'dark' ? Sun : Moon,
      keywords: ['toggle theme', 'dark mode', 'light mode', 'appearance'],
      run: () => {
        toggleTheme()
        onClose()
      },
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      icon: Keyboard,
      keywords: ['help', 'hotkeys'],
      shortcut: shortcutKeys('help'),
      run: () => {
        onClose()
        onShowShortcuts()
      },
    },
    {
      id: 'logout',
      label: 'Log out',
      icon: LogOut,
      keywords: ['sign out', 'logout'],
      run: () => {
        onClose()
        void logout()
      },
    },
  ].filter((a) => hasMinRole(role, a.minRole))

  const requestId = looksLikeRequestId(search) ? search.trim() : null

  return (
    <Command label="Command palette" loop className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Search pages and actions, or paste a request id…"
          className="h-12 min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
        <Kbd keys="escape" className="hidden sm:inline-flex" />
      </div>
      <Command.List className={`max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-2 ${groupClass}`}>
        {!requestId && (
          <Command.Empty className="px-3 py-6 text-center text-sm text-text-tertiary">No results found.</Command.Empty>
        )}

        {requestId && (
          <Command.Group heading="Jump to request" forceMount>
            <Command.Item
              value={`open request ${requestId}`}
              forceMount
              onSelect={() => go(`/usage/logs?request=${encodeURIComponent(requestId)}`)}
              className={itemClass}
            >
              <ItemBody icon={ScrollText} label={`Open request ${requestId}`} />
            </Command.Item>
          </Command.Group>
        )}

        {!search && recent.length > 0 && (
          <Command.Group heading="Recent">
            {recent.map((p) => (
              <Command.Item key={p.path} value={`recent ${p.path}`} onSelect={() => go(p.path)} className={itemClass}>
                <ItemBody icon={Clock} label={p.label} />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Navigate">
          {pages.map((p) => (
            <Command.Item
              key={p.path}
              value={`page ${p.path} ${p.label}`}
              keywords={[p.label, ...(p.keywords ?? [])]}
              onSelect={() => go(p.path)}
              className={itemClass}
            >
              <ItemBody icon={p.icon} label={p.label} shortcut={shortcutForPath(p.path)} />
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Actions">
          {actions.map((a) => (
            <Command.Item
              key={a.id}
              value={`action ${a.id} ${a.label}`}
              keywords={[a.label, ...(a.keywords ?? [])]}
              onSelect={a.run}
              className={itemClass}
            >
              <ItemBody icon={a.icon} label={a.label} shortcut={a.shortcut} />
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command>
  )
}
