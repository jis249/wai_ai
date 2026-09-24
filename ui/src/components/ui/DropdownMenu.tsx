import React from 'react'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '../../lib/utils'

/** Root. Controlled via `open`/`onOpenChange` or uncontrolled. */
export const DropdownMenu = DropdownPrimitive.Root

/** Use `asChild` to wrap a Button/IconButton: `<DropdownMenuTrigger asChild><IconButton .../></DropdownMenuTrigger>`. */
export const DropdownMenuTrigger = DropdownPrimitive.Trigger

export const DropdownMenuGroup = DropdownPrimitive.Group

/** Shared floating-panel surface (also used by Popover). */
const panelClasses =
  'z-[60] min-w-[10rem] overflow-hidden rounded-lg border border-border bg-bg-secondary p-1 shadow-xl'

export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>

/** Portaled, themed menu panel. Defaults: align="end", sideOffset=4. */
export const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  function DropdownMenuContent({ className, align = 'end', sideOffset = 4, ...rest }, ref) {
    return (
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(panelClasses, className)}
          {...rest}
        />
      </DropdownPrimitive.Portal>
    )
  },
)

export interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> {
  /** Leading icon (16px). */
  icon?: React.ReactNode
  /** Red text for delete/revoke style actions. */
  destructive?: boolean
  /** Right-aligned hint (e.g. keyboard shortcut). */
  shortcut?: React.ReactNode
}

/** Menu item. Handle clicks with `onSelect` (fires on click and Enter). */
export const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  function DropdownMenuItem({ className, icon, destructive = false, shortcut, children, ...rest }, ref) {
    return (
      <DropdownPrimitive.Item
        ref={ref}
        className={cn(
          'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          destructive
            ? 'text-error data-[highlighted]:bg-error/10'
            : 'text-text-secondary data-[highlighted]:bg-bg-tertiary data-[highlighted]:text-text-primary',
          className,
        )}
        {...rest}
      >
        {icon != null && (
          <span className="inline-flex shrink-0 [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="flex-1 truncate">{children}</span>
        {shortcut != null && <span className="ml-4 text-xs text-text-tertiary">{shortcut}</span>}
      </DropdownPrimitive.Item>
    )
  },
)

export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>

export const DropdownMenuSeparator = React.forwardRef<HTMLDivElement, DropdownMenuSeparatorProps>(
  function DropdownMenuSeparator({ className, ...rest }, ref) {
    return <DropdownPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...rest} />
  },
)

export type DropdownMenuLabelProps = React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>

export const DropdownMenuLabel = React.forwardRef<HTMLDivElement, DropdownMenuLabelProps>(
  function DropdownMenuLabel({ className, ...rest }, ref) {
    return (
      <DropdownPrimitive.Label
        ref={ref}
        className={cn('px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-widest text-text-tertiary', className)}
        {...rest}
      />
    )
  },
)
