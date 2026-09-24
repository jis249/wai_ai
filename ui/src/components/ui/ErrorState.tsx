import React from 'react'
import { cn } from '../../lib/utils'
import { Button } from './Button'
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
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
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
