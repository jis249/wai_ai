import { useMemo } from 'react'
import { useMe, type MeResponse } from './useMe'

/** Roles in ascending privilege — mirrors backend `ROLE_RANK` (src/wai/api/admin/common.py). */
export const ROLES = ['member', 'team_admin', 'org_admin', 'system_admin'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_RANK: Record<Role, number> = {
  member: 0,
  team_admin: 1,
  org_admin: 2,
  system_admin: 3,
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value)
}

/** Rank of a role string; unknown/missing roles rank as member (0). */
export function roleRank(role: string | null | undefined): number {
  return isRole(role) ? ROLE_RANK[role] : 0
}

/** True when `role` is at least `required` (like backend `has_role`, but unknown → member). */
export function hasRole(role: string | null | undefined, required: Role): boolean {
  return roleRank(role) >= ROLE_RANK[required]
}

/** "org_admin" → "Org Admin" */
export function formatRole(role: string | null | undefined): string {
  if (!role) return ''
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export interface Permissions {
  /** Effective role (system admins flagged via `is_system_admin` resolve to 'system_admin'). */
  role: Role
  rank: number
  /** False while /me is loading — gate redirects on this to avoid flashing. Flags are member-level until ready. */
  isReady: boolean
  isSystemAdmin: boolean
  /** org_admin or higher. */
  isOrgAdmin: boolean
  /** team_admin or higher. */
  isTeamAdmin: boolean
  isMember: boolean
  /** Manage (create/revoke/rotate) other users' keys org-wide: org_admin+. Everyone can manage their own. */
  canManageKeys: boolean
  /** Create teams / manage team membership: team_admin+ (team_admin limited to own teams server-side). */
  canManageTeams: boolean
  /** Invite / remove org members, change roles: org_admin+. */
  canManageMembers: boolean
  /** Org settings, SSO, model & MCP org access: org_admin+. */
  canManageOrg: boolean
  /** Org-wide usage, cost reports, audit log: org_admin+ (others see their own usage). */
  canViewOrgUsage: boolean
  canViewAuditLog: boolean
  /** Service accounts: org_admin+. */
  canManageServiceAccounts: boolean
  /** Platform setup, host metrics, auto-routing, all orgs/users, token limits: system_admin. */
  canManagePlatform: boolean
  /** `hasRole(role, required)` bound to the current user. */
  atLeast: (required: Role) => boolean
}

export function derivePermissions(me: MeResponse | undefined): Omit<Permissions, 'isReady'> {
  const raw = me?.role
  const role: Role = me?.is_system_admin === true ? 'system_admin' : isRole(raw) ? raw : 'member'
  const rank = ROLE_RANK[role]
  const isSystemAdmin = rank >= ROLE_RANK.system_admin
  const isOrgAdmin = rank >= ROLE_RANK.org_admin
  const isTeamAdmin = rank >= ROLE_RANK.team_admin
  return {
    role,
    rank,
    isSystemAdmin,
    isOrgAdmin,
    isTeamAdmin,
    isMember: rank === ROLE_RANK.member,
    canManageKeys: isOrgAdmin,
    canManageTeams: isTeamAdmin,
    canManageMembers: isOrgAdmin,
    canManageOrg: isOrgAdmin,
    canViewOrgUsage: isOrgAdmin,
    canViewAuditLog: isOrgAdmin,
    canManageServiceAccounts: isOrgAdmin,
    canManagePlatform: isSystemAdmin,
    atLeast: (required: Role) => rank >= ROLE_RANK[required],
  }
}

/** Role-derived capability flags for the signed-in user (from `useMe`). */
export function usePermissions(): Permissions {
  const { data, isLoading } = useMe()
  return useMemo(() => ({ ...derivePermissions(data), isReady: !isLoading }), [data, isLoading])
}
