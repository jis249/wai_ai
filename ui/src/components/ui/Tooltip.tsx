import React, { createContext, useContext } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'

export interface TooltipProviderProps {
  children: React.ReactNode
  /** Hover delay before opening, in ms (default 300). */
  delayDuration?: number
}

const HasProviderContext = createContext(false)

/** Mount once near the app root (App.tsx does this). */
export function TooltipProvider({ children, delayDuration = 300 }: TooltipProviderProps) {
  return (
    <HasProviderContext.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={200}>
        {children}
      </TooltipPrimitive.Provider>
    </HasProviderContext.Provider>
  )
}

/** Shared floating-surface classes for tooltip content. */
const contentClasses =
  'z-[60] max-w-xs rounded-md border border-border bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-primary shadow-lg select-none'

export interface TooltipProps {
  /** Tooltip text/content. When null/undefined/'' the child is rendered without a tooltip. */
  content: React.ReactNode
  /** A single element that can hold a ref (DOM element or forwardRef component). */
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Override the provider delay for this tooltip. */
  delayDuration?: number
  /** Disable without unmounting the child. */
  disabled?: boolean
  className?: string
}

/**
 * Themed Radix tooltip rendered in a portal.
 * Uses the nearest `<TooltipProvider>` (App.tsx); falls back to a local provider
 * so isolated renders (tests, portals outside the app tree) still work.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  delayDuration,
  disabled = false,
  className,
}: TooltipProps) {
  const hasProvider = useContext(HasProviderContext)
  if (disabled || content == null || content === '' || content === false) return children
  const tooltip = (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(contentClasses, className)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
  return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>
}
