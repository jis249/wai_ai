export const RECENT_PAGES_KEY = 'wai_recent_pages'
/** Pages shown in the palette's Recent group (the current page is excluded, so one extra is stored). */
export const RECENT_PAGES_SHOWN = 5
export const RECENT_PAGES_LIMIT = RECENT_PAGES_SHOWN + 1

export function readRecentPages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(0, RECENT_PAGES_LIMIT) : []
  } catch {
    return []
  }
}

/** Moves `path` to the front of the recent list (deduplicated, capped). */
export function recordRecentPage(path: string): string[] {
  const next = [path, ...readRecentPages().filter((p) => p !== path)].slice(0, RECENT_PAGES_LIMIT)
  try {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable: recent list is best-effort
  }
  return next
}
