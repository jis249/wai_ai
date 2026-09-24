import React, { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useAddTeamMember } from '../../hooks/useTeamMembers'
import { useOrgMemberOptions } from '../../hooks/useOrgMembers'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import type { RoleOption } from './memberRules'

export interface AddTeamMemberDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
  teamId: string
  existingMemberIds: ReadonlySet<string>
  roleOptions: RoleOption[]
}

/** Add an existing org member to a team (team members must already belong to the org). */
export function AddTeamMemberDialog({ open, onClose, orgId, teamId, existingMemberIds, roleOptions }: AddTeamMemberDialogProps) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('member')
  const [userIdError, setUserIdError] = useState<string | undefined>()

  const addMember = useAddTeamMember(orgId, teamId)
  const { toast } = useToast()
  const options = useOrgMemberOptions(open ? orgId : '', existingMemberIds)
  const memberOptions = options.data ?? []

  function handleClose() {
    setUserId('')
    setRole('member')
    setUserIdError(undefined)
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) {
      setUserIdError('Select an organization member')
      return
    }
    addMember.mutate(
      { user_id: userId, role },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'Member added to team' })
          handleClose()
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to add member') }),
      },
    )
  }

  const noCandidates = options.isSuccess && memberOptions.length === 0

  return (
    <Dialog open={open} onClose={handleClose} title="Add team member">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-xs text-text-tertiary">
          Only members of this organization can be added. Invite new people from the organization Members page first.
        </p>
        <Select
          label="Organization member"
          options={memberOptions.map((u) => ({ value: u.userId, label: u.label, description: u.description }))}
          value={userId}
          onChange={(v) => {
            setUserId(v)
            if (v) setUserIdError(undefined)
          }}
          searchable
          placeholder={
            options.isLoading ? 'Loading members...' : noCandidates ? 'Everyone is already on this team' : 'Search by name or email...'
          }
          error={options.isError ? errorMessage(options.error, 'Could not load org members') : userIdError}
          disabled={addMember.isPending || options.isLoading || noCandidates}
        />
        <div>
          <p id="team-role-label" className="mb-1.5 block text-sm font-medium text-text-secondary">
            Role
          </p>
          <SegmentedControl aria-labelledby="team-role-label" options={roleOptions} value={role} onChange={setRole} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={addMember.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={addMember.isPending} disabled={noCandidates}>
            Add member
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
