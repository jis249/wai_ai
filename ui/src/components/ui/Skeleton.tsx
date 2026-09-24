import React from 'react'
import { cn } from '../../lib/utils'

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

/** Pulsing placeholder block. Size it with className (e.g. `h-4 w-32`). */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-bg-tertiary', className)} {...rest} />
}

export interface SkeletonTextProps {
  /** Number of lines (default 3). The last line is shorter. */
  lines?: number
  className?: string
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

export interface SkeletonRowsProps {
  /** Number of rows (default 5). */
  rows?: number
  /** Number of columns per row (default 4). */
  columns?: number
  className?: string
}

/** Table-like placeholder rows for lists outside of <Table>. */
export function SkeletonRows({ rows = 5, columns = 4, className }: SkeletonRowsProps) {
  return (
    <div className={cn('divide-y divide-border', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className={cn('h-4 flex-1', j === 0 && 'max-w-[40%]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export interface SkeletonCardProps {
  /** Height of the body placeholder (Tailwind class, default `h-48`). */
  bodyClassName?: string
  className?: string
}

/** Card-shaped placeholder: title bar + body block, matching <Card>. */
export function SkeletonCard({ bodyClassName = 'h-48', className }: SkeletonCardProps) {
  return (
    <div className={cn('bg-bg-secondary rounded-xl border border-border p-6', className)} aria-hidden="true">
      <Skeleton className="mb-6 h-5 w-40" />
      <Skeleton className={cn('w-full rounded-lg', bodyClassName)} />
    </div>
  )
}
