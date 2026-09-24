import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../../lib/utils'

/** Root. Controlled via `open`/`onOpenChange` or uncontrolled. */
export const Popover = PopoverPrimitive.Root

/** Use `asChild` to wrap your own button. */
export const PopoverTrigger = PopoverPrimitive.Trigger

/** Position the popover against an element other than the trigger. */
export const PopoverAnchor = PopoverPrimitive.Anchor

/** Closes the popover when clicked (use `asChild` around a Button). */
export const PopoverClose = PopoverPrimitive.Close

export type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>

/** Portaled, themed panel. Defaults: align="start", sideOffset=6, p-4, w-72. */
export const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(function PopoverContent(
  { className, align = 'start', sideOffset = 6, ...rest },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-[60] w-72 rounded-xl border border-border bg-bg-secondary p-4 text-text-primary shadow-xl outline-none',
          className,
        )}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  )
})
