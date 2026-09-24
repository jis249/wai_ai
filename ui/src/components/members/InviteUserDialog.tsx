import React, { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { CopyButton } from '../ui/CopyButton'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useCreateInvite } from '../../hooks/useInvites'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import type { RoleOption } from './memberRules'

export interface InviteUserDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
  /** Roles the viewer may invite as (org_admin only for system admins). */
  roleOptions: RoleOption[]
  title?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Invite by email; shows the one-time invite link when the API returns a token. */
export function InviteUserDialog({ open, onClose, orgId, roleOptions, title = 'Invite member' }: InviteUserDialogProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [emailError, setEmailError] = useState<string | undefined>()
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const createInvite = useCreateInvite(orgId)
  const { toast } = useToast()

  function handleClose() {
    setEmail('')
    setRole('member')
    setEmailError(undefined)
    setInviteLink(null)
    onClose()
  }

  function validate(): boolean {
    const trimmed = email.trim()
    if (!trimmed) {
      setEmailError('Email is required')
      return false
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Enter a valid email address')
      return false
    }
    setEmailError(undefined)
    return true
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    createInvite.mutate(
      { email: email.trim(), role },
      {
        onSuccess: (data) => {
          if (data.token) {
            setInviteLink(`${window.location.origin}/invite/${data.token}`)
          } else {
            toast({ variant: 'success', message: 'Invite sent' })
            handleClose()
          }
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to send invite') }),
      },
    )
  }

  if (inviteLink !== null) {
    return (
      <Dialog
        open={open}
        onClose={handleClose}
        title="Invite created"
        footer={
          <div className="flex justify-end">
            <Button onClick={handleClose}>Done</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Share this invite link with{' '}
            <span className="break-all font-medium text-text-primary">{email.trim()}</span>.
          </p>
          <div className="rounded-md border border-border bg-bg-tertiary px-3 py-2">
            <p className="break-all font-mono text-xs text-text-tertiary">{inviteLink}</p>
          </div>
          <CopyButton text={inviteLink} label="Copy link" />
          <p className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
            The link expires in 7 days and can only be used once.
          </p>
        </div>
      </Dialog>
    )
  }

  const showRolePicker = roleOptions.length > 1

  return (
    <Dialog open={open} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (emailError) setEmailError(undefined)
          }}
          placeholder="user@example.com"
          error={emailError}
          disabled={createInvite.isPending}
        />
        {showRolePicker ? (
          <div>
            <p id="invite-role-label" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Role
            </p>
            <SegmentedControl
              aria-labelledby="invite-role-label"
              options={roleOptions}
              value={role}
              onChange={setRole}
            />
          </div>
        ) : (
          <p className="text-xs text-text-tertiary">
            The user joins as a Member. Only system admins can invite org admins.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={createInvite.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={createInvite.isPending}>
            Send invite
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
