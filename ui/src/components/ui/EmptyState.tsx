import React from 'react'
import { cn } from '../../lib/utils'
import { Button } from './Button'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: React.ReactNode
}

export interface EmptyStateProps {
  /** Icon element (e.g. `<KeyRound className="h-6 w-6" />`); rendered in a round tertiary bubble. */
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  /** Primary call to action (Button variant="primary"). */
  action?: EmptyStateAction
  /** Optional secondary action (Button variant="secondary"). */
  secondaryAction?: EmptyStateAction
  /** `plain` (default) sits inside an existing card; `card` draws its own bordered surface. */
  variant?: 'plain' | 'card'
  /** Extra content rendered below the actions (links, custom buttons). */
  children?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'plain',
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        variant === 'card' && 'rounded-xl border border-border bg-bg-secondary',
        className,
      )}
    >
      {icon != null && (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div className="max-w-md">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        {description != null && <p className="mt-1 text-sm text-text-tertiary">{description}</p>}
      </div>
      {(action != null || secondaryAction != null) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action != null && (
            <Button size="sm" icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction != null && (
            <Button size="sm" variant="secondary" icon={secondaryAction.icon} onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
