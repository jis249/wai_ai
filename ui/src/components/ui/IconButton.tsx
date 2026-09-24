import React from 'react'
import { cn } from '../../lib/utils'
import { Tooltip } from './Tooltip'

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Required accessible name; also used as the tooltip text. */
  'aria-label': string
  icon: React.ReactNode
  variant?: 'ghost' | 'secondary' | 'destructive'
  size?: 'sm' | 'md'
  loading?: boolean
  /** Tooltip content override (defaults to aria-label). Pass `false` to disable the tooltip. */
  tooltip?: React.ReactNode | false
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

const variantClasses: Record<NonNullable<IconButtonProps['variant']>, string> = {
  ghost: 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary',
  secondary: 'border border-border text-text-secondary hover:text-text-primary hover:bg-bg-tertiary',
  destructive: 'text-text-tertiary hover:text-error hover:bg-error/10',
}

const sizeClasses: Record<NonNullable<IconButtonProps['size']>, string> = {
  sm: 'h-7 w-7 [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-9 w-9 [&_svg]:h-[18px] [&_svg]:w-[18px]',
}

/** Icon-only button. Always labelled; shows its label in a tooltip on hover/focus. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    'aria-label': ariaLabel,
    icon,
    variant = 'ghost',
    size = 'md',
    loading = false,
    disabled = false,
    tooltip,
    tooltipSide = 'top',
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        variantClasses[variant],
        sizeClasses[size],
        isDisabled && 'opacity-50 cursor-not-allowed hover:bg-transparent',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        <span className="inline-flex" aria-hidden="true">
          {icon}
        </span>
      )}
    </button>
  )

  if (tooltip === false) return button
  return (
    <Tooltip content={tooltip ?? ariaLabel} side={tooltipSide}>
      {button}
    </Tooltip>
  )
})
