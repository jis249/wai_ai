import { ConfirmDialog } from '../ui/Dialog'
import type { MemberContext } from './memberRules'

export interface RemoveMemberDialogProps {
  open: boolean
  onClose: () => void
  context: MemberContext
  memberName: string
  loading?: boolean
  onConfirm: () => void
}

function description(context: MemberContext, name: string): string {
  return context === 'org'
    ? `Remove ${name} from the organization? Their API keys and team memberships remain, but they lose org access.`
    : `Remove ${name} from this team? They keep their organization membership.`
}

export function RemoveMemberDialog({ open, onClose, context, memberName, loading = false, onConfirm }: RemoveMemberDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={context === 'org' ? 'Remove member' : 'Remove from team'}
      description={description(context, memberName)}
      confirmLabel="Remove"
      loading={loading}
    />
  )
}
