import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { MobileNavDrawer } from './MobileNavDrawer'
import { IconButton } from '../ui/IconButton'
import { Menu, Search } from '../ui/icons'
import { CommandCenter } from '../command/CommandCenter'
import { useCommandCenter } from '../command/context'
import { SIDEBAR_COLLAPSED_KEY } from '../../lib/constants'
import { cn } from '../../lib/utils'

/** Matches Tailwind's `lg` breakpoint: the fixed sidebar is shown at and above it. */
const DESKTOP_QUERY = '(min-width: 1024px)'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // storage unavailable (private mode / blocked): keep in-memory state only
  }
}

export function Shell() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  // Path the drawer was opened on; navigating anywhere else closes it without an effect.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const drawerOpen = drawerPath !== null && drawerPath === location.pathname

  const closeDrawer = useCallback(() => setDrawerPath(null), [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      writeCollapsed(next)
      return next
    })
  }

  // Growing past the breakpoint hides the drawer via CSS; also release its scroll lock.
  useEffect(() => {
    if (!drawerOpen || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(DESKTOP_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) closeDrawer()
    }
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [drawerOpen, closeDrawer])

  return (
    <CommandCenter>
      <div className="min-h-screen bg-bg-primary">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-accent focus:text-white focus:rounded-md focus:m-2"
        >
          Skip to content
        </a>

        {/* Desktop: fixed rail */}
        <div className="hidden lg:block">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </div>

        {/* Mobile / tablet: sticky top bar + off-canvas drawer */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-bg-secondary/95 px-2 backdrop-blur lg:hidden">
          <IconButton
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="mobile-navigation"
            icon={<Menu />}
            onClick={() => setDrawerPath(location.pathname)}
            tooltip={false}
          />
          <Link to="/" aria-label="wai home" className="flex min-w-0 items-center gap-2 no-underline">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
            <span className="gradient-text text-xl font-bold">wai</span>
          </Link>
          <MobileSearchButton />
        </header>
        <MobileNavDrawer open={drawerOpen} onClose={closeDrawer}>
          <Sidebar variant="drawer" onClose={closeDrawer} onNavigate={closeDrawer} />
        </MobileNavDrawer>

        <main
          id="main-content"
          className={cn(
            'min-w-0 p-4 sm:p-6 lg:p-8 transition-[margin] duration-200',
            collapsed ? 'lg:ml-[72px] lg:max-w-[calc(100%-72px)]' : 'lg:ml-[260px] lg:max-w-[calc(100%-260px)]',
          )}
        >
          <Outlet />
        </main>
      </div>
    </CommandCenter>
  )
}

/** Mobile top bar entry point to the command palette. */
function MobileSearchButton() {
  const commandCenter = useCommandCenter()
  if (!commandCenter) return null
  return (
    <button
      type="button"
      onClick={commandCenter.openPalette}
      className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-text-tertiary transition-colors hover:border-accent/40 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Search…</span>
    </button>
  )
}
