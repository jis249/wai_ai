import { useMemo, useState } from 'react'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { Shield, UserPlus, Users } from '../components/ui/icons'
import { MembersTable } from '../components/members/MembersTable'
import { AddTeamMemberDialog } from '../components/members/AddTeamMemberDialog'
import { ChangeRoleDialog } from '../components/members/ChangeRoleDialog'
import { RemoveMemberDialog } from '../components/members/RemoveMemberDialog'
import { useCursorPager } from '../components/members/listState'
import { isAdminRole, roleOptionsFor } from '../components/members/memberRules'
import { useMe } from '../hooks/useMe'
import { usePermissions } from '../hooks/usePermissions'
import {
  useTeamMembers,
  useRemoveTeamMember,
  useUpdateTeamMember,
  type TeamMembershipResponse,
} from '../hooks/useTeamMembers'
import type { UserResponse } from '../hooks/useUsers'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'

interface Target {
  member: TeamMembershipResponse
  name: string
}

function targetName(user: UserResponse | undefined): string {
  return user?.display_name || user?.email || 'this member'
}

export default function TeamMembersTab() {
  const { teamId = '' } = useParams<{ teamId: string }>()
  const { data: me } = useMe()
  const perms = usePermissions()
  const orgId = useActiveOrgId()
  const canManage = perms.canManageTeams
  const { toast } = useToast()
  const pager = useCursorPager()

  const membersQuery = useTeamMembers(orgId, teamId, pager.cursor)
  const removeMember = useRemoveTeamMember(orgId, teamId)
  const updateMember = useUpdateTeamMember(orgId, teamId)

  const [showAdd, setShowAdd] = useState(false)
  const [roleTarget, setRoleTarget] = useState<Target | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Target | null>(null)

  const members = useMemo(() => membersQuery.data?.data ?? [], [membersQuery.data])
  const existingIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members])
  const adminCount = members.filter((m) => isAdminRole(m.role)).length
  const roleOptions = roleOptionsFor('team', perms.isSystemAdmin)

  function handleRoleChange(newRole: string) {
    if (!roleTarget) return
    updateMember.mutate(
      { membershipId: roleTarget.member.id, role: newRole },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: `Role updated for ${roleTarget.name}` })
          setRoleTarget(null)
        },
        onError: (err) => {
          toast({ variant: 'error', message: errorMessage(err, 'Failed to update role') })
          setRoleTarget(null)
        },
      },
    )
  }

  function handleRemove() {
    if (!removeTarget) return
    removeMember.mutate(removeTarget.member.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `${removeTarget.name} removed from the team` })
        setRemoveTarget(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to remove member') })
        setRemoveTarget(null)
      },
    })
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-text-secondary">Team members must already belong to the organization.</p>
        {canManage && (
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setShowAdd(true)}>
            Add member
          </Button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Members"
          value={membersQuery.isPending ? '-' : members.length}
          iconColor="purple"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Team admins"
          value={membersQuery.isPending ? '-' : adminCount}
          iconColor="blue"
          icon={<Shield className="h-4 w-4" />}
        />
      </div>

      <MembersTable<TeamMembershipResponse>
        context="team"
        members={members}
        viewer={{ userId: me?.id, role: perms.role, isSystemAdmin: perms.isSystemAdmin, canManage }}
        loading={membersQuery.isPending && !!orgId && !!teamId}
        error={membersQuery.isError ? membersQuery.error : undefined}
        onRetry={() => void membersQuery.refetch()}
        pagination={pager.pagination(membersQuery.data)}
        onChangeRole={(member, user) => setRoleTarget({ member, name: targetName(user) })}
        onRemove={(member, user) => setRemoveTarget({ member, name: targetName(user) })}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No members yet"
            description="Add organization members to start collaborating."
            action={canManage ? { label: 'Add member', onClick: () => setShowAdd(true) } : undefined}
          />
        }
      />

      <AddTeamMemberDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        orgId={orgId}
        teamId={teamId}
        existingMemberIds={existingIds}
        roleOptions={roleOptions}
      />

      <ChangeRoleDialog
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        context="team"
        memberName={roleTarget?.name ?? ''}
        currentRole={roleTarget?.member.role ?? 'member'}
        roleOptions={roleOptions}
        loading={updateMember.isPending}
        onConfirm={handleRoleChange}
      />

      <RemoveMemberDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        context="team"
        memberName={removeTarget?.name ?? ''}
        loading={removeMember.isPending}
        onConfirm={handleRemove}
      />
    </>
  )
}
