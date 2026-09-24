import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface TypeToConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: React.ReactNode
  /** The text the user must type exactly (e.g. the key or account name). */
  confirmText: string
  confirmLabel?: string
  loading?: boolean
}

/** Destructive confirmation that requires typing the resource name (ConfirmDialog-style). */
export function TypeToConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  confirmLabel = 'Delete',
  loading = false,
}: TypeToConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === confirmText.trim()

  function handleClose() {
    setTyped('')
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (matches && !loading) onConfirm()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" type="submit" form="type-to-confirm-form" disabled={!matches} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <form id="type-to-confirm-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="text-sm text-text-secondary">{description}</div>
        <Input
          label={`Type "${confirmText}" to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
          autoFocus
        />
      </form>
    </Dialog>
  )
}
