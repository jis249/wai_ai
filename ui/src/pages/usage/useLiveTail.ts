import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchRequestLogsAfter,
  type AfterCursor,
  type RequestLogFilters,
  type RequestLogRow,
} from '../../hooks/useRequestLogs'

export const LIVE_TAIL_INTERVAL_MS = 3000
/** Max rows kept in memory (shown + buffered) by the request log page. */
export const LIVE_TAIL_MAX_ROWS = 2000
export const LIVE_HIGHLIGHT_MS = 2000

/** Cursor for "everything" when nothing is loaded yet (no rows exist for these filters). */
const EPOCH_CURSOR: AfterCursor = { after: '1970-01-01T00:00:00+00:00', after_id: '' }

export interface UseLiveTailOptions {
  /** The Live toggle. */
  enabled: boolean
  /** Buffer new rows instead of prepending (user scrolled away / viewing details). */
  paused: boolean
  /** Id of the row open in a detail view; also pauses when that row came from the live tail. */
  openRowId?: string
  /** Filters for polls (callers drop the `to` bound for preset ranges). */
  filters: RequestLogFilters
  /** Identity of the current filter set; changing it discards live rows. */
  resetKey: string
  /** Newest row already on screen (from the paged query), used to seed the cursor. */
  newestLoaded: RequestLogRow | undefined
  intervalMs?: number
}

export interface LiveTailState {
  /** New rows to show above the paged rows (newest first). */
  rows: RequestLogRow[]
  /** Rows received while paused (not yet shown). */
  pending: RequestLogRow[]
  /** Row ids to highlight briefly. */
  highlighted: ReadonlySet<string>
  /** True while the tab is hidden (polling stopped). */
  hidden: boolean
  error: unknown
  /** Show buffered rows now. */
  flush: () => void
}

interface Store {
  key: string
  rows: RequestLogRow[]
  pending: RequestLogRow[]
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * Live tail for the request log: while enabled and the tab is visible, polls every
 * `intervalMs` for rows newer than the newest known row (`after` / `after_id`), and
 * prepends them (or buffers them while paused). Rows are capped at LIVE_TAIL_MAX_ROWS.
 */
export function useLiveTail({
  enabled,
  paused: pausedProp,
  openRowId,
  filters,
  resetKey,
  newestLoaded: newestPaged,
  intervalMs = LIVE_TAIL_INTERVAL_MS,
}: UseLiveTailOptions): LiveTailState {
  const [store, setStore] = useState<Store>({ key: resetKey, rows: [], pending: [] })
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(() => new Set())
  const [hidden, setHidden] = useState(isHidden)
  const [error, setError] = useState<unknown>(null)

  // Discard live rows when the filters change (render-phase reset, no flash of stale rows).
  const current = store.key === resetKey ? store : { key: resetKey, rows: [], pending: [] }
  if (current !== store) setStore(current)

  const paused = pausedProp || (openRowId != null && current.rows.some((r) => r.id === openRowId))
  const newestLoaded = current.pending[0] ?? current.rows[0] ?? newestPaged

  const cursorRef = useRef<{ key: string; cursor: AfterCursor } | null>(null)
  const inFlight = useRef(false)
  const latest = useRef({ paused, filters, resetKey, newestLoaded, pending: current.pending })
  useEffect(() => {
    latest.current = { paused, filters, resetKey, newestLoaded, pending: current.pending }
  })

  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])

  const highlight = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setHighlighted((prev) => new Set([...prev, ...ids]))
    const t = setTimeout(() => {
      timers.current.delete(t)
      setHighlighted((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    }, LIVE_HIGHLIGHT_MS)
    timers.current.add(t)
  }, [])

  const flush = useCallback(() => {
    const ids = latest.current.pending.map((r) => r.id)
    if (ids.length === 0) return
    setStore((s) =>
      s.pending.length === 0 ? s : { ...s, rows: [...s.pending, ...s.rows].slice(0, LIVE_TAIL_MAX_ROWS), pending: [] },
    )
    highlight(ids)
  }, [highlight])

  // Track tab visibility; polling stops while hidden.
  useEffect(() => {
    const onChange = () => setHidden(isHidden())
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const active = enabled && !hidden

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const tick = async () => {
      if (inFlight.current) return
      const { filters: f, resetKey: key, newestLoaded: newest } = latest.current
      if (cursorRef.current?.key !== key) {
        cursorRef.current = {
          key,
          cursor: newest != null ? { after: newest.created_at, after_id: newest.id } : EPOCH_CURSOR,
        }
      }
      inFlight.current = true
      try {
        const res = await fetchRequestLogsAfter(f, cursorRef.current.cursor)
        if (cancelled || latest.current.resetKey !== key) return
        setError(null)
        const fresh = res.data ?? []
        // No longer paused: buffered rows are shown together with this poll's rows.
        const buffered = latest.current.paused ? [] : latest.current.pending
        if (fresh.length === 0) {
          if (buffered.length > 0) flush()
          return
        }
        cursorRef.current = {
          key,
          cursor: {
            after: res.latest_created_at || fresh[0].created_at,
            after_id: res.latest_id || fresh[0].id,
          },
        }
        if (latest.current.paused) {
          setStore((s) =>
            s.key !== key ? s : { ...s, pending: [...fresh, ...s.pending].slice(0, LIVE_TAIL_MAX_ROWS) },
          )
        } else {
          setStore((s) =>
            s.key !== key
              ? s
              : { ...s, rows: [...fresh, ...s.pending, ...s.rows].slice(0, LIVE_TAIL_MAX_ROWS), pending: [] },
          )
          highlight([...fresh, ...buffered].map((r) => r.id))
        }
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        inFlight.current = false
      }
    }

    void tick()
    const id = setInterval(() => void tick(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [active, resetKey, intervalMs, highlight, flush])

  // Turning live off keeps the rows already shown but restarts the cursor next time.
  useEffect(() => {
    if (!enabled) cursorRef.current = null
  }, [enabled])

  return { rows: current.rows, pending: current.pending, highlighted, hidden, error, flush }
}
