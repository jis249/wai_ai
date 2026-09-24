import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MembersTable } from './MembersTable'
import { memberActionState, type MemberRecord, type MemberViewer } from './memberRules'
import type { UserResponse } from '../../hooks/useUsers'

function user(id: string, name: string, extra: Partial<UserResponse> = {}): UserResponse {
  return {
    id,
    email: `${name.toLowerCase()}@example.com`,
    display_name: name,
    auth_provider: 'local',
    is_system_admin: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...extra,
  }
}

const USERS = [
  user('u-me', 'Olivia'), // viewer (org admin)
  user('u-admin', 'Adam'),
  user('u-bob', 'Bob'),
  user('u-cara', 'Cara'),
  user('u-sys', 'Sysop', { is_system_admin: true }),
]

const MEMBERS: MemberRecord[] = [
  { id: 'm-me', user_id: 'u-me', role: 'org_admin', created_at: '2024-01-01T00:00:00Z' },
  { id: 'm-admin', user_id: 'u-admin', role: 'org_admin', created_at: '2024-01-02T00:00:00Z' },
  { id: 'm-bob', user_id: 'u-bob', role: 'member', created_at: '2024-01-03T00:00:00Z' },
  { id: 'm-cara', user_id: 'u-cara', role: 'member', created_at: '2024-01-04T00:00:00Z' },
  { id: 'm-sys', user_id: 'u-sys', role: 'member', created_at: '2024-01-05T00:00:00Z' },
]

const ORG_ADMIN: MemberViewer = { userId: 'u-me', role: 'org_admin', isSystemAdmin: false, canManage: true }
const SYS_ADMIN: MemberViewer = { userId: 'u-root', role: 'system_admin', isSystemAdmin: true, canManage: true }

function renderTable(props: Partial<React.ComponentProps<typeof MembersTable>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  USERS.forEach((u) => client.setQueryData(['user', u.id], u))
  const onChangeRole = vi.fn()
  const onRemove = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <MembersTable
        context="org"
        members={MEMBERS}
        viewer={ORG_ADMIN}
        complete
        onChangeRole={onChangeRole}
        onRemove={onRemove}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onChangeRole, onRemove }
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`row for ${name} not found`)
  return row
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in test'))))
})

describe('MembersTable filtering', () => {
  it('filters by name/email search', async () => {
    renderTable()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'bo')
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.queryByText('Cara')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 5 shown')).toBeInTheDocument()
  })

  it('filters by role and can clear filters from the empty state', async () => {
    renderTable()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by role' }), 'org_admin')
    expect(screen.getByText('Adam')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'zzz')
    expect(screen.getByText('No matching members')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Cara')).toBeInTheDocument()
  })
})

describe('MembersTable actions', () => {
  it('disables actions on members with an equal/higher role, system admins and self', () => {
    renderTable()
    // Another org admin (equal role) -> both actions disabled for an org admin viewer
    const adam = within(rowFor('Adam'))
    expect(adam.getByRole('button', { name: 'Remove Adam' })).toBeDisabled()
    expect(adam.getByRole('button', { name: 'Change role for Adam' })).toBeDisabled()
    // System admin user (even with member role) -> locked
    expect(within(rowFor('Sysop')).getByRole('button', { name: 'Remove Sysop' })).toBeDisabled()
    // Self -> cannot remove yourself
    expect(within(rowFor('Olivia')).getByRole('button', { name: 'Remove Olivia' })).toBeDisabled()
    // Lower role -> remove allowed; org role changes are system-admin only
    const bob = within(rowFor('Bob'))
    expect(bob.getByRole('button', { name: 'Remove Bob' })).toBeEnabled()
    expect(bob.getByRole('button', { name: 'Change role for Bob' })).toBeDisabled()
  })

  it('lets system admins manage anyone and calls back with the member', async () => {
    const { onChangeRole, onRemove } = renderTable({ viewer: SYS_ADMIN })
    const adam = within(rowFor('Adam'))
    await userEvent.click(adam.getByRole('button', { name: 'Change role for Adam' }))
    expect(onChangeRole).toHaveBeenCalledWith(MEMBERS[1], USERS[1])
    await userEvent.click(adam.getByRole('button', { name: 'Remove Adam' }))
    expect(onRemove).toHaveBeenCalledWith(MEMBERS[1], USERS[1])
  })

  it('protects the last org admin even for system admins', () => {
    const members = MEMBERS.filter((m) => m.id !== 'm-admin')
    renderTable({ viewer: SYS_ADMIN, members })
    const olivia = within(rowFor('Olivia'))
    expect(olivia.getByRole('button', { name: 'Remove Olivia' })).toBeDisabled()
    expect(olivia.getByRole('button', { name: 'Change role for Olivia' })).toBeDisabled()
  })

  it('hides the actions column when the viewer cannot manage members', () => {
    renderTable({ viewer: { ...ORG_ADMIN, role: 'member', canManage: false } })
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })
})

describe('memberActionState (team context)', () => {
  const teamAdmin: MemberViewer = { userId: 'u-ta', role: 'team_admin', isSystemAdmin: false, canManage: true }
  it('team admins cannot modify other team admins or remove themselves', () => {
    const other = { id: 'x', user_id: 'u-x', role: 'team_admin', created_at: '' }
    const self = { id: 'y', user_id: 'u-ta', role: 'team_admin', created_at: '' }
    const member = { id: 'z', user_id: 'u-z', role: 'member', created_at: '' }
    expect(memberActionState({ context: 'team', viewer: teamAdmin, member: other }).canRemove).toBe(false)
    expect(memberActionState({ context: 'team', viewer: teamAdmin, member: self }).canRemove).toBe(false)
    const m = memberActionState({ context: 'team', viewer: teamAdmin, member })
    expect(m.canRemove && m.canChangeRole).toBe(true)
  })
})
