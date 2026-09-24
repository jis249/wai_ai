import React, { useId } from 'react'
import ReactDOM from 'react-dom'
import { cn } from '../../lib/utils'
import { Button } from './Button'
import { useModalBehavior } from './useModalBehavior'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  closeOnEscape = true,
  closeOnBackdrop = true,
}: DialogProps) {
  const titleId = useId()
  const { panelRef, handlePanelKeyDown } = useModalBehavior({ open, onClose, closeOnEscape })

  if (!open) return null

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose()
  }

  return ReactDOM.createPortal(
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel rounded-2xl shadow-2xl max-w-xl w-full mx-4 p-6 border border-border border-t-accent/15 max-h-[90vh] flex flex-col backdrop-blur-xl"
        onKeyDown={handlePanelKeyDown}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div
          className={cn('flex-1 overflow-y-auto', className)}
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}
        >{children}</div>

        {footer != null && <div className="mt-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel?: string
  loading?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Delete',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-text-secondary">{description}</p>
    </Dialog>
  )
}
