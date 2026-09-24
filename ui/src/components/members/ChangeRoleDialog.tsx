import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'
import { formatRole, roleRank } from '../../hooks/usePermissions'
import type { MemberContext, RoleOption } from './memberRules'

export interface ChangeRoleDialogProps {
  open: boolean
  onClose: () => void
  context: MemberContext
  memberName: string
  currentRole: string
  roleOptions: RoleOption[]
  loading?: boolean
  onConfirm: (newRole: string) => void
}

function consequence(context: MemberContext, from: string, to: string): string {
  const scope = context === 'org' ? 'this organization' : 'this team'
  if (roleRank(to) > roleRank(from)) return `They will gain ${formatRole(to)} access to ${scope}.`
  if (roleRank(to) < roleRank(from)) return `They will lose administrative access to ${scope}.`
  return ''
}

/** Pick a new role for a member; Save is disabled until the role actually changes. */
export function ChangeRoleDialog(props: ChangeRoleDialogProps) {
  if (!props.open) return null
  // Keyed remount resets the selection each time the dialog opens for a member.
  return <ChangeRoleDialogInner key={`${props.memberName}:${props.currentRole}`} {...props} />
}

function ChangeRoleDialogInner({
  open,
  onClose,
  context,
  memberName,
  currentRole,
  roleOptions,
  loading = false,
  onConfirm,
}: ChangeRoleDialogProps) {
  const [role, setRole] = useState(currentRole)
  const changed = role !== currentRole
  const note = changed ? consequence(context, currentRole, role) : ''

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change role"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(role)} loading={loading} disabled={!changed}>
            Save role
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Choose a role for <span className="break-all font-medium text-text-primary">{memberName}</span>. Current
          role: {formatRole(currentRole)}.
        </p>
        <SegmentedControl aria-label="Role" options={roleOptions} value={role} onChange={setRole} />
        {note && <p className="text-xs text-text-tertiary">{note}</p>}
      </div>
    </Dialog>
  )
}
