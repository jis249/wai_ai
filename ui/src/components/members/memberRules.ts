import { ROLE_RANK, formatRole, roleRank, type Role } from '../../hooks/usePermissions'

/** Where a member list lives: org memberships (`/orgs/:id/members`) or team memberships. */
export type MemberContext = 'org' | 'team'

/** Minimal membership shape shared by org and team memberships. */
export interface MemberRecord {
  id: string
  user_id: string
  role: string
  created_at: string
}

export interface RoleOption {
  value: string
  label: string
}

/** Roles a membership can hold in each context (backend VALID_ROLES). */
export const CONTEXT_ROLES: Record<MemberContext, readonly string[]> = {
  org: ['member', 'org_admin'],
  team: ['member', 'team_admin'],
}

/** The admin role of a context: org_admin for orgs, team_admin for teams. */
export const CONTEXT_ADMIN_ROLE: Record<MemberContext, Role> = {
  org: 'org_admin',
  team: 'team_admin',
}

/** Role options for a context. Only system admins may assign org_admin (backend rule). */
export function roleOptionsFor(context: MemberContext, viewerIsSystemAdmin: boolean): RoleOption[] {
  return CONTEXT_ROLES[context]
    .filter((r) => context !== 'org' || r !== 'org_admin' || viewerIsSystemAdmin)
    .map((r) => ({ value: r, label: formatRole(r) }))
}

/** team_admin or higher counts as an admin row. */
export function isAdminRole(role: string): boolean {
  return roleRank(role) >= ROLE_RANK.team_admin
}

export interface MemberViewer {
  userId: string | undefined
  /** Effective role of the signed-in user. */
  role: Role
  isSystemAdmin: boolean
  /** Whether the viewer may manage this member list at all. */
  canManage: boolean
}

export interface MemberActionState {
  canChangeRole: boolean
  canRemove: boolean
  /** Why role change is unavailable (shown as tooltip), when it is. */
  changeRoleReason?: string
  removeReason?: string
}

export interface MemberActionInput {
  context: MemberContext
  viewer: MemberViewer
  member: MemberRecord
  /** Target user is a system admin (from /users/:id). */
  targetIsSystemAdmin?: boolean
  /** True when this member is the org's only org_admin (known only when the full list is loaded). */
  isLastOrgAdmin?: boolean
}

const REASON_HIGHER = 'You can only manage members with a lower role than yours'
const REASON_SYSADMIN = 'Only a system admin can change a system admin'
const REASON_LAST_ADMIN = 'An organization needs at least one org admin'

/**
 * Mirrors the backend membership guards:
 * - non-system-admins cannot change/remove members whose role is >= their own, or system admins;
 * - the last org_admin can't be demoted or removed (409);
 * - only system admins may assign org_admin, so org role changes are system-admin only.
 * Plus UI rules: nobody changes their own role; you can't remove yourself from an org here;
 * in a team only org admins+ may remove themselves (team admins would lose access).
 */
export function memberActionState({
  context,
  viewer,
  member,
  targetIsSystemAdmin = false,
  isLastOrgAdmin = false,
}: MemberActionInput): MemberActionState {
  if (!viewer.canManage) return { canChangeRole: false, canRemove: false }

  const isSelf = viewer.userId != null && member.user_id === viewer.userId
  const viewerRank = ROLE_RANK[viewer.role]

  let changeRoleReason: string | undefined
  let removeReason: string | undefined

  if (!viewer.isSystemAdmin) {
    if (targetIsSystemAdmin || member.role === 'system_admin') {
      changeRoleReason = REASON_SYSADMIN
      removeReason = REASON_SYSADMIN
    } else if (roleRank(member.role) >= viewerRank && !isSelf) {
      changeRoleReason = REASON_HIGHER
      removeReason = REASON_HIGHER
    }
  }

  if (!changeRoleReason) {
    if (isSelf) changeRoleReason = "You can't change your own role"
    else if (context === 'org' && !viewer.isSystemAdmin) changeRoleReason = 'Only system admins can change org roles'
    else if (context === 'org' && isLastOrgAdmin) changeRoleReason = REASON_LAST_ADMIN
  }

  if (!removeReason) {
    if (isSelf && context === 'org') removeReason = "You can't remove yourself"
    else if (isSelf && viewerRank < ROLE_RANK.org_admin) removeReason = "Team admins can't remove themselves"
    else if (context === 'org' && isLastOrgAdmin) removeReason = REASON_LAST_ADMIN
  }

  return {
    canChangeRole: changeRoleReason == null,
    canRemove: removeReason == null,
    changeRoleReason,
    removeReason,
  }
}
