import React from 'react'
import { Card, CardHeader } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { ChartColumn } from '../ui/icons'
import { cn } from '../../lib/utils'

/** Minimal query shape (any TanStack `useQuery` result fits). */
export interface SectionQuery {
  isError: boolean
  error: unknown
  isLoading: boolean
  isFetching?: boolean
  data: unknown
  refetch: () => unknown
}

export interface ChartSectionProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Query that feeds this section; drives loading / error states. */
  query?: SectionQuery
  /** Extra loading flag (e.g. derived from several queries). */
  loading?: boolean
  /** True when there is nothing to plot. */
  isEmpty: boolean
  emptyTitle?: string
  emptyDescription?: string
  errorTitle?: string
  /** Skeleton classes while loading (default `h-48 w-full rounded-lg`). */
  skeletonClassName?: string
  className?: string
  children: React.ReactNode
}

/** Card with a title and built-in loading skeleton, error (with retry) and empty states. */
export function ChartSection({
  title,
  description,
  actions,
  query,
  loading,
  isEmpty,
  emptyTitle = 'No data',
  emptyDescription = 'Nothing was recorded in the selected time range.',
  errorTitle = "Couldn't load this chart",
  skeletonClassName = 'h-48 w-full rounded-lg',
  className,
  children,
}: ChartSectionProps) {
  let body: React.ReactNode
  if (query?.isError && query.data == null) {
    body = (
      <ErrorState
        title={errorTitle}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="py-8"
      />
    )
  } else if (loading ?? query?.isLoading) {
    body = <Skeleton className={skeletonClassName} />
  } else if (isEmpty) {
    body = (
      <EmptyState
        icon={<ChartColumn className="w-6 h-6" />}
        title={emptyTitle}
        description={emptyDescription}
        className="py-8"
      />
    )
  } else {
    body = children
  }
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader title={title} description={description} actions={actions} className="flex-wrap" />
      {body}
    </Card>
  )
}
