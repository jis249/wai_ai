import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMe } from '../../hooks/useMe'
import { useHotkeys, type Hotkey } from '../../hooks/useHotkeys'
import { accessiblePages } from '../layout/navigation'
import { CommandCenterContext } from './context'
import { CommandPalette } from './CommandPalette'
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog'
import { readRecentPages, recordRecentPage, RECENT_PAGES_SHOWN } from './recentPages'
import { SHORTCUTS } from './shortcuts'

/** Focuses the page's primary search box: `[data-page-search]`, else the first `input[type="search"]`. */
function focusPageSearch(): boolean {
  const el =
    document.querySelector<HTMLElement>('[data-page-search]') ??
    document.querySelector<HTMLElement>('input[type="search"]')
  if (!el) return false
  el.focus()
  if (el instanceof HTMLInputElement) el.select()
  return true
}

/**
 * Owns the command palette, the shortcuts help dialog, the global hotkeys and the
 * recent-pages log. Render once inside the router (Shell does).
 */
export function CommandCenter({ children }: { children: React.ReactNode }) {
  const { data } = useMe()
  const role = data?.role ?? 'member'
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [recentPaths, setRecentPaths] = useState<string[]>(readRecentPages)

  const knownPaths = useMemo(() => new Set(accessiblePages(role).map((p) => p.path)), [role])
  useEffect(() => {
    if (!knownPaths.has(pathname)) return
    // Sync the visit log (external storage) with the router location.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentPaths(recordRecentPage(pathname))
  }, [pathname, knownPaths])

  const openPalette = useCallback(() => {
    setHelpOpen(false)
    setPaletteOpen(true)
  }, [])
  const openShortcuts = useCallback(() => {
    setPaletteOpen(false)
    setHelpOpen(true)
  }, [])

  const hotkeys = useMemo<Hotkey[]>(
    () =>
      SHORTCUTS.flatMap((s): Hotkey[] => {
        if (s.id === 'palette') {
          return [{ keys: s.keys, handler: () => (paletteOpen ? setPaletteOpen(false) : openPalette()) }]
        }
        if (s.id === 'help') return [{ keys: s.keys, handler: openShortcuts }]
        if (s.id === 'search') {
          return [
            {
              keys: s.keys,
              preventDefault: false,
              handler: (e) => {
                if (focusPageSearch()) e.preventDefault()
              },
            },
          ]
        }
        if (s.path) {
          const path = s.path
          return [{ keys: s.keys, handler: () => navigate(path) }]
        }
        return [] // escape: handled by each modal
      }),
    [navigate, openPalette, openShortcuts, paletteOpen],
  )
  useHotkeys(hotkeys)

  const value = useMemo(() => ({ openPalette, openShortcuts }), [openPalette, openShortcuts])

  return (
    <CommandCenterContext.Provider value={value}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        role={role}
        recentPaths={recentPaths.filter((p) => p !== pathname).slice(0, RECENT_PAGES_SHOWN)}
        onShowShortcuts={openShortcuts}
      />
      <ShortcutsHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </CommandCenterContext.Provider>
  )
}
