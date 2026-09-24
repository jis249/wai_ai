import React from 'react'
import { cn } from '../../lib/utils'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Inner padding. `md` (default) = p-6, the standard section card; `none` for edge-to-edge content like tables. */
  padding?: 'none' | 'sm' | 'md'
  /** Render as a different element (e.g. `section`). */
  as?: 'div' | 'section' | 'article'
}

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-6',
}

/** Section surface: `bg-bg-secondary rounded-xl border border-border p-6`. */
export function Card({ padding = 'md', as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cn('bg-bg-secondary rounded-xl border border-border', paddingClasses[padding], className)}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned controls (buttons, pickers). */
  actions?: React.ReactNode
  /** Optional leading icon next to the title. */
  icon?: React.ReactNode
}

export function CardHeader({ title, description, actions, icon, className, ...rest }: CardHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)} {...rest}>
      <div className="flex min-w-0 items-start gap-3">
        {icon != null && (
          <span className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {description != null && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export type CardBodyProps = React.HTMLAttributes<HTMLDivElement>

export function CardBody({ className, children, ...rest }: CardBodyProps) {
  return (
    <div className={cn('min-w-0', className)} {...rest}>
      {children}
    </div>
  )
}
