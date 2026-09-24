import { useState } from 'react'
import { Button } from '../ui/Button'
import { StatCard } from '../ui/StatCard'
import { EmptyState } from '../ui/EmptyState'
import { ShieldCheck, UserPlus, Users } from '../ui/icons'
import {
  useOrgMembers,
  useDeleteOrgMember,
  useUpdateOrgMember,
  type OrgMembershipResponse,
} from '../../hooks/useOrgMembers'
import { useMe } from '../../hooks/useMe'
import { usePermissions } from '../../hooks/usePermissions'
import { useToast } from '../../hooks/useToast'
import type { UserResponse } from '../../hooks/useUsers'
import { errorMessage } from '../../lib/errors'
import { MembersTable } from './MembersTable'
import { InviteUserDialog } from './InviteUserDialog'
import { DeepLinkParam } from '../onboarding/DeepLinkParam'
import { ChangeRoleDialog } from './ChangeRoleDialog'
import { RemoveMemberDialog } from './RemoveMemberDialog'
import { useCursorPager } from './listState'
import { isAdminRole, roleOptionsFor } from './memberRules'

interface Target {
  member: OrgMembershipResponse
  name: string
}

function targetName(user: UserResponse | undefined): string {
  return user?.display_name || user?.email || 'this member'
}

/** Org members management (stats, searchable table, invite / change role / remove). */
export function OrgMembersPanel({ orgId }: { orgId: string }) {
  const { data: me } = useMe()
  const perms = usePermissions()
  const { toast } = useToast()
  const pager = useCursorPager()

  const membersQuery = useOrgMembers(orgId, pager.cursor)
  const deleteMember = useDeleteOrgMember(orgId)
  const updateMember = useUpdateOrgMember(orgId)

  const [showInvite, setShowInvite] = useState(false)
  const [roleTarget, setRoleTarget] = useState<Target | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Target | null>(null)

  const members = membersQuery.data?.data ?? []
  const adminCount = members.filter((m) => isAdminRole(m.role)).length
  const complete = pager.isFirstPage && !(membersQuery.data?.has_more ?? false)
  const roleOptions = roleOptionsFor('org', perms.isSystemAdmin)

  function handleRoleChange(newRole: string) {
    if (!roleTarget) return
    updateMember.mutate(
      { membershipId: roleTarget.member.id, params: { role: newRole } },
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
    deleteMember.mutate(removeTarget.member.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `${removeTarget.name} removed from the organization` })
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
        <p className="min-w-0 text-sm text-text-secondary">People with access to this organization.</p>
        <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setShowInvite(true)}>
          Invite member
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label={complete ? 'Members' : 'Members (this page)'}
          value={membersQuery.isPending ? '-' : members.length}
          iconColor="purple"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Admins"
          value={membersQuery.isPending ? '-' : adminCount}
          iconColor="blue"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      <MembersTable<OrgMembershipResponse>
        context="org"
        members={members}
        viewer={{ userId: me?.id, role: perms.role, isSystemAdmin: perms.isSystemAdmin, canManage: perms.canManageMembers }}
        loading={membersQuery.isPending && !!orgId}
        error={membersQuery.isError ? membersQuery.error : undefined}
        onRetry={() => void membersQuery.refetch()}
        pagination={pager.pagination(membersQuery.data)}
        complete={complete}
        onChangeRole={(member, user) => setRoleTarget({ member, name: targetName(user) })}
        onRemove={(member, user) => setRemoveTarget({ member, name: targetName(user) })}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No members yet"
            description="Invite people to join this organization."
            action={{ label: 'Invite member', onClick: () => setShowInvite(true) }}
          />
        }
      />

      {perms.canManageMembers && <DeepLinkParam name="invite" onMatch={() => setShowInvite(true)} />}
      <InviteUserDialog open={showInvite} onClose={() => setShowInvite(false)} orgId={orgId} roleOptions={roleOptions} />

      <ChangeRoleDialog
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        context="org"
        memberName={roleTarget?.name ?? ''}
        currentRole={roleTarget?.member.role ?? 'member'}
        roleOptions={roleOptions}
        loading={updateMember.isPending}
        onConfirm={handleRoleChange}
      />

      <RemoveMemberDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        context="org"
        memberName={removeTarget?.name ?? ''}
        loading={deleteMember.isPending}
        onConfirm={handleRemove}
      />
    </>
  )
}
