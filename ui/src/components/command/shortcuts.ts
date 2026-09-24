/** Global keyboard shortcuts: the single list used by the hotkey wiring, palette hints and help dialog. */

export interface ShortcutDef {
  id: string
  /** useHotkeys syntax: "mod+k", "?", "g d". */
  keys: string
  description: string
  group: 'General' | 'Navigation'
  /** Navigation shortcuts: where they go. */
  path?: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'palette', keys: 'mod+k', description: 'Open command palette', group: 'General' },
  { id: 'help', keys: '?', description: 'Show keyboard shortcuts', group: 'General' },
  { id: 'search', keys: '/', description: 'Focus page search', group: 'General' },
  { id: 'close', keys: 'escape', description: 'Close dialog or palette', group: 'General' },
  { id: 'go-dashboard', keys: 'g d', description: 'Go to dashboard', group: 'Navigation', path: '/' },
  { id: 'go-playground', keys: 'g p', description: 'Go to playground', group: 'Navigation', path: '/playground' },
  { id: 'go-keys', keys: 'g k', description: 'Go to API keys', group: 'Navigation', path: '/keys' },
  { id: 'go-models', keys: 'g m', description: 'Go to models', group: 'Navigation', path: '/models' },
  { id: 'go-logs', keys: 'g l', description: 'Go to request logs', group: 'Navigation', path: '/usage/logs' },
  { id: 'go-usage', keys: 'g u', description: 'Go to usage', group: 'Navigation', path: '/usage' },
  { id: 'go-org', keys: 'g o', description: 'Go to organization', group: 'Navigation', path: '/org' },
  { id: 'go-settings', keys: 'g s', description: 'Go to settings', group: 'Navigation', path: '/org/settings' },
]

/** Shortcut keys for a path, if a navigation shortcut targets it. */
export function shortcutForPath(path: string): string | undefined {
  return SHORTCUTS.find((s) => s.path === path)?.keys
}

export function shortcutKeys(id: string): string {
  return SHORTCUTS.find((s) => s.id === id)?.keys ?? ''
}
