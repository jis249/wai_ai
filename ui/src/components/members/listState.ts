import { useMemo, useState } from 'react'
import type { PaginationState, SortState } from '../ui/Table'

// ---------------------------------------------------------------------------
// useCursorPager: cursor pagination state shared by list pages
// ---------------------------------------------------------------------------

export function useCursorPager() {
  const [cursor, setCursor] = useState<string | undefined>()
  const [prevCursors, setPrevCursors] = useState<string[]>([])

  function pagination(page: { has_more?: boolean; next_cursor?: string } | undefined): PaginationState {
    return {
      cursor: cursor ?? null,
      hasMore: page?.has_more ?? false,
      hasPrevious: prevCursors.length > 0,
      onNext: () => {
        if (page?.next_cursor) {
          setPrevCursors((prev) => [...prev, cursor ?? ''])
          setCursor(page.next_cursor)
        }
      },
      onPrevious: () => {
        const prev = prevCursors[prevCursors.length - 1]
        setPrevCursors((p) => p.slice(0, -1))
        setCursor(prev || undefined)
      },
    }
  }

  return { cursor, isFirstPage: prevCursors.length === 0, pagination }
}

// ---------------------------------------------------------------------------
// useClientSort: sort the loaded rows by a column (Table `sort`/`onSort`)
// ---------------------------------------------------------------------------

export type SortAccessors<T> = Record<string, (row: T) => string | number>

export function useClientSort<T>(rows: T[], accessors: SortAccessors<T>, initial?: SortState) {
  const [sort, setSort] = useState<SortState | undefined>(initial)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const get = accessors[sort.column]
    if (!get) return rows
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = get(a)
      const bv = get(b)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir
    })
    // accessors are expected to be stable per render; rows/sort drive recomputation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])

  function onSort(column: string) {
    setSort((prev) =>
      prev?.column === column ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' },
    )
  }

  return { sorted, sort, onSort }
}

/** Case-insensitive "any field contains the query" filter. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => f != null && f.toLowerCase().includes(q))
}
