import { useEffect, useRef } from 'react'
import type React from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Open modal surfaces, oldest first. Only the top-most one reacts to Escape. */
const modalStack: symbol[] = []

export interface ModalBehaviorOptions {
  open: boolean
  onClose: () => void
  closeOnEscape?: boolean
}

/**
 * Shared modal mechanics for Dialog and Sheet:
 * - Escape closes (top-most modal only; ignored when a Radix popper menu/popover has focus
 *   or another handler already called preventDefault)
 * - focus moves to the first focusable element on open and is restored on close
 * - body scroll is locked while open
 * - returns `panelRef` and an `onKeyDown` Tab-trap handler for the panel element
 */
export function useModalBehavior({ open, onClose, closeOnEscape = true }: ModalBehaviorOptions) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<Element | null>(null)
  // Latest callbacks in refs so the stack position is tied to `open` only
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  useEffect(() => {
    onCloseRef.current = onClose
    closeOnEscapeRef.current = closeOnEscape
  })

  // Escape key — respects nested consumers via defaultPrevented and the modal stack
  useEffect(() => {
    if (!open) return
    const token = Symbol('modal')
    modalStack.push(token)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !closeOnEscapeRef.current) return
      if (modalStack[modalStack.length - 1] !== token) return
      const target = e.target
      if (target instanceof Element && target.closest('[data-radix-popper-content-wrapper]')) return
      e.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const idx = modalStack.indexOf(token)
      if (idx >= 0) modalStack.splice(idx, 1)
    }
  }, [open])

  // Focus management: save previous focus, focus first focusable on open, restore on close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement
      const rafId = requestAnimationFrame(() => {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
        focusable?.[0]?.focus()
      })
      return () => cancelAnimationFrame(rafId)
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [open])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return { panelRef, handlePanelKeyDown }
}
