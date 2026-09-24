import { createContext, useContext } from 'react'

export interface CommandCenterValue {
  openPalette: () => void
  openShortcuts: () => void
}

export const CommandCenterContext = createContext<CommandCenterValue | null>(null)

/** Palette/shortcut openers, or null outside a CommandCenter (e.g. an isolated Sidebar). */
export function useCommandCenter(): CommandCenterValue | null {
  return useContext(CommandCenterContext)
}
