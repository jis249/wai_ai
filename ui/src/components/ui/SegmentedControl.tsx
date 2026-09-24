import React, { useRef } from 'react'
import { cn } from '../../lib/utils'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string
}

export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[]
  value: T
  /**
   * Called on click (including a click on the already-selected segment, so callers can
   * e.g. reopen a "Custom" popover) and when arrow keys move the selection.
   */
  onChange: (value: T) => void
  /** Accessible name for the group (e.g. "Time range"). */
  'aria-label'?: string
  'aria-labelledby'?: string
  size?: 'sm' | 'md'
  /** Stretch to container width with equal-width segments. */
  fullWidth?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
} as const

/**
 * Single-select button group (role="group", aria-pressed).
 * Roving tabindex: Tab focuses the selected segment; Arrow keys / Home / End move and select.
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const tabStop = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : (enabled[0] ?? -1)

  function move(from: number, key: string) {
    if (enabled.length === 0) return
    const pos = enabled.indexOf(from)
    let next: number
    if (key === 'Home') next = enabled[0]
    else if (key === 'End') next = enabled[enabled.length - 1]
    else if (key === 'ArrowRight' || key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length]
    else next = enabled[(pos - 1 + enabled.length) % enabled.length]
    buttonsRef.current[next]?.focus()
    if (options[next].value !== value) onChange(options[next].value)
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      move(index, e.key)
    }
  }

  return (
    <div
      role="group"
      {...aria}
      className={cn('inline-flex gap-1 rounded-lg bg-bg-tertiary p-1', fullWidth && 'flex w-full', className)}
    >
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            ref={(el) => {
              buttonsRef.current[i] = el
            }}
            type="button"
            aria-pressed={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              sizeClasses[size],
              fullWidth && 'flex-1',
              active
                ? 'bg-bg-secondary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary',
              opt.disabled && 'opacity-50 cursor-not-allowed hover:text-text-tertiary',
            )}
          >
            {opt.icon != null && (
              <span className="shrink-0" aria-hidden="true">
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
