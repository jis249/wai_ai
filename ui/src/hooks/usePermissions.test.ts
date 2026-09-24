import { describe, it, expect } from 'vitest'
import { derivePermissions, hasRole, roleRank } from './usePermissions'
import type { MeResponse } from './useMe'

function me(role: string, is_system_admin = false): MeResponse {
  return { id: 'u1', email: 'a@b.c', display_name: 'A', role, is_system_admin }
}

describe('usePermissions', () => {
  it('ranks roles like the backend', () => {
    expect(roleRank('member')).toBe(0)
    expect(roleRank('team_admin')).toBe(1)
    expect(roleRank('org_admin')).toBe(2)
    expect(roleRank('system_admin')).toBe(3)
    expect(roleRank('toString')).toBe(0)
    expect(roleRank(undefined)).toBe(0)
    expect(hasRole('org_admin', 'team_admin')).toBe(true)
    expect(hasRole('team_admin', 'org_admin')).toBe(false)
  })

  it('member has no admin flags', () => {
    const p = derivePermissions(me('member'))
    expect(p).toMatchObject({ role: 'member', isMember: true, isTeamAdmin: false, isOrgAdmin: false, canManageKeys: false })
  })

  it('team_admin can manage teams but not keys org-wide', () => {
    const p = derivePermissions(me('team_admin'))
    expect(p).toMatchObject({ isTeamAdmin: true, isOrgAdmin: false, canManageTeams: true, canManageKeys: false })
  })

  it('org_admin is team_admin+ and can manage keys/org', () => {
    const p = derivePermissions(me('org_admin'))
    expect(p).toMatchObject({ isTeamAdmin: true, isOrgAdmin: true, isSystemAdmin: false, canManageKeys: true, canManageOrg: true })
    expect(p.atLeast('org_admin')).toBe(true)
    expect(p.atLeast('system_admin')).toBe(false)
  })

  it('is_system_admin flag elevates any role to system_admin', () => {
    const p = derivePermissions(me('member', true))
    expect(p).toMatchObject({ role: 'system_admin', isSystemAdmin: true, isOrgAdmin: true, canManagePlatform: true })
  })

  it('unknown role or no user falls back to member', () => {
    expect(derivePermissions(me('superuser')).role).toBe('member')
    expect(derivePermissions(undefined).role).toBe('member')
  })
})
