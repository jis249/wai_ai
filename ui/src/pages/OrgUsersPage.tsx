import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonRows } from '../components/ui/Skeleton'
import { Lock } from '../components/ui/icons'
import { OrgMembersPanel } from '../components/members/OrgMembersPanel'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { usePermissions } from '../hooks/usePermissions'

/** /org/users: members of the signed-in user's organization. */
export default function OrgUsersPage() {
  const orgId = useActiveOrgId()
  const perms = usePermissions()

  if (!perms.isReady) return <SkeletonRows rows={5} columns={3} />

  if (!perms.canManageMembers) {
    return (
      <EmptyState
        variant="card"
        icon={<Lock className="h-6 w-6" />}
        title="Admins only"
        description="Only organization admins can manage members."
      />
    )
  }

  return <OrgMembersPanel orgId={orgId} />
}
