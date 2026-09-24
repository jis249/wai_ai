import type React from 'react'
import ReactDOM from 'react-dom'
import { useModalBehavior } from '../ui/useModalBehavior'

export interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

/**
 * Off-canvas left drawer for the main navigation below the `lg` breakpoint.
 * Same modal mechanics as Dialog/Sheet (Escape, backdrop click, focus trap + restore,
 * body scroll lock) without Sheet's title bar, so the Sidebar renders edge to edge.
 */
export function MobileNavDrawer({ open, onClose, children }: MobileNavDrawerProps) {
  const { panelRef, handlePanelKeyDown } = useModalBehavior({ open, onClose })

  if (!open) return null

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return ReactDOM.createPortal(
    <div
      className="dialog-overlay fixed inset-0 z-50 flex justify-start backdrop-blur-sm lg:hidden"
      onMouseDown={handleBackdropMouseDown}
      data-testid="mobile-nav-overlay"
    >
      <div
        ref={panelRef}
        id="mobile-navigation"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="h-full w-[280px] max-w-[85vw] shadow-2xl"
        onKeyDown={handlePanelKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
