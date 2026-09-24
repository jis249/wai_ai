import React, { useId } from 'react'
import ReactDOM from 'react-dom'
import { cn } from '../../lib/utils'
import { useModalBehavior } from './useModalBehavior'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  /** Secondary line under the title. */
  description?: React.ReactNode
  children: React.ReactNode
  /** Sticky footer (e.g. Cancel / Save buttons). */
  footer?: React.ReactNode
  /** Edge the panel slides from (default "right"). */
  side?: 'right' | 'left'
  /** Panel width: preset or any CSS length (e.g. 640, '42rem'). Default "md" (480px). Capped at 100vw. */
  width?: 'sm' | 'md' | 'lg' | 'xl' | number | string
  /** Extra controls in the header, left of the close button. */
  headerActions?: React.ReactNode
  /** Classes for the scrollable body. */
  className?: string
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
}

const widthPresets = { sm: 384, md: 480, lg: 640, xl: 800 } as const

function resolveWidth(width: SheetProps['width']): string {
  if (width == null) return `${widthPresets.md}px`
  if (typeof width === 'number') return `${width}px`
  if (width in widthPresets) return `${widthPresets[width as keyof typeof widthPresets]}px`
  return width
}

/**
 * Side drawer. Same modal mechanics as <Dialog>: portal, Escape, backdrop click,
 * focus trap + restore, body scroll lock. role="dialog" aria-modal.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  width = 'md',
  headerActions,
  className,
  closeOnEscape = true,
  closeOnBackdrop = true,
}: SheetProps) {
  const titleId = useId()
  const descId = useId()
  const { panelRef, handlePanelKeyDown } = useModalBehavior({ open, onClose, closeOnEscape })

  if (!open) return null

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose()
  }

  return ReactDOM.createPortal(
    <div
      className={cn('dialog-overlay fixed inset-0 z-50 flex backdrop-blur-sm', side === 'right' ? 'justify-end' : 'justify-start')}
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        className={cn(
          'dialog-panel flex h-full max-w-[100vw] flex-col border-border shadow-2xl backdrop-blur-xl',
          side === 'right' ? 'border-l' : 'border-r',
        )}
        style={{ width: resolveWidth(width) }}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text-primary truncate">
              {title}
            </h2>
            {description != null && (
              <p id={descId} className="mt-1 text-sm text-text-secondary">
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div
          className={cn('flex-1 overflow-y-auto px-6 py-5', className)}
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}
        >
          {children}
        </div>

        {footer != null && <div className="border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
