import React from 'react'
import { ErrorState } from './ErrorState'
import { SkeletonText } from './Skeleton'

/**
 * Structural subset of TanStack Query's `UseQueryResult` — any `useQuery(...)`
 * result satisfies it.
 */
export interface QueryLike<T> {
  data: T | undefined
  error: unknown
  isPending: boolean
  isError: boolean
  isFetching?: boolean
  /** 'idle' + isPending means the query is disabled (`enabled: false`) and has no data. */
  fetchStatus?: 'fetching' | 'paused' | 'idle'
  refetch: () => unknown
}

export interface QueryStateProps<T> {
  query: QueryLike<T>
  /** Rendered with the loaded (non-empty) data. */
  children: (data: T) => React.ReactNode
  /** Loading UI (default: 3-line skeleton). */
  loading?: React.ReactNode
  /** Empty UI (default: nothing). Shown when `isEmpty(data)` is true, or when the query is disabled with no data. */
  empty?: React.ReactNode
  /**
   * Emptiness test. Default: `null`/`undefined`, an empty array, or an object whose
   * `data` field is an empty array (the API's paginated `{ data: [...] }` shape).
   */
  isEmpty?: (data: T) => boolean
  /** Custom error UI. Receives the error and a retry callback (calls `query.refetch()`). */
  error?: (error: unknown, retry: () => void) => React.ReactNode
  /** Heading for the default ErrorState. */
  errorTitle?: string
}

function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true
  if (Array.isArray(data)) return data.length === 0
  if (typeof data === 'object' && 'data' in data) {
    const inner = (data as { data: unknown }).data
    if (Array.isArray(inner)) return inner.length === 0
  }
  return false
}

/**
 * Declarative loading / error (with retry) / empty / data switch for a query.
 *
 * - Error is only shown when there is no data to render; a failed background
 *   refetch keeps showing the previous data.
 */
export function QueryState<T>({
  query,
  children,
  loading,
  empty = null,
  isEmpty = defaultIsEmpty,
  error,
  errorTitle,
}: QueryStateProps<T>) {
  const retry = () => {
    void query.refetch()
  }

  if (query.data === undefined) {
    if (query.isError) {
      return <>{error ? error(query.error, retry) : <ErrorState title={errorTitle} error={query.error} onRetry={retry} retrying={query.isFetching} />}</>
    }
    if (query.isPending && query.fetchStatus === 'idle') return <>{empty}</>
    if (query.isPending) return <>{loading ?? <SkeletonText lines={3} />}</>
  }

  const data = query.data as T
  if (isEmpty(data)) return <>{empty}</>
  return <>{children(data)}</>
}
