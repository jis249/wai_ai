import React from 'react'
import { cn } from '../../lib/utils'
import { Button } from './Button'
import { TriangleAlert } from './icons'
import { errorMessage } from '../../lib/errors'

export interface ErrorStateProps {
  /** Heading (default "Something went wrong"). */
  title?: string
  /** Explicit message. If omitted, derived from `error`. */
  message?: React.ReactNode
  /** Any thrown value; `Error.message` is shown when `message` is not provided. */
  error?: unknown
  /** Shows a Retry button when provided. */
  onRetry?: () => void
  /** Spinner on the Retry button (e.g. `query.isFetching`). */
  retrying?: boolean
  /** `plain` (default) sits inside an existing card; `card` draws its own bordered surface. */
  variant?: 'plain' | 'card'
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  error,
  onRetry,
  retrying = false,
  variant = 'plain',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
        variant === 'card' && 'rounded-xl border border-border bg-bg-secondary',
        className,
      )}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-error/10 text-error"
        aria-hidden="true"
      >
        <TriangleAlert className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="max-w-md">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <p className="mt-1 text-sm text-text-tertiary break-words">{message ?? errorMessage(error)}</p>
      </div>
      {onRetry != null && (
        <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  )
}
