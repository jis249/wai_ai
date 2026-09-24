import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import KeysPage from '../KeysPage'

function key(id: string, name: string, userId: string) {
  return {
    id, name, key_hint: `wa_uk_${id}`, key_type: 'user_key', org_id: 'o1', team_id: null, user_id: userId,
    service_account_id: null, daily_token_limit: 0, monthly_token_limit: 0, requests_per_minute: 0,
    requests_per_day: 0, expires_at: null, last_used_at: null, created_by: userId,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }
}

const KEYS = [key('k1', 'Alpha', 'u1'), key('k2', 'Bravo', 'u1'), key('k3', 'Charlie', 'u1'), key('k9', 'Theirs', 'u2')]

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function setup(path = '/keys') {
  const deletes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: 'x', json: () => Promise.resolve(body) })
      if (method === 'DELETE') {
        const id = url.split('/').pop() ?? ''
        deletes.push(id)
        if (id === 'k2') return json({ error: { message: 'Key is owned by a peer admin' } }, 403)
        return { ok: true, status: 204, json: () => Promise.resolve(undefined) }
      }
      if (url.endsWith('/me')) return json({ id: 'u1', email: 'a@b.c', display_name: 'A', role: 'member', org_id: 'o1', is_system_admin: false })
      if (url.includes('/orgs/o1/keys')) return json({ data: KEYS.filter((k) => !deletes.includes(k.id) || k.id === 'k2'), has_more: false })
      if (url.includes('/teams') || url.includes('/service-accounts')) return json({ data: [], has_more: false })
      if (url.endsWith('/me/available-models')) return json({ models: [] })
      return json({})
    }),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <KeysPage hideHeader />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { deletes, user: userEvent.setup() }
}

afterEach(() => vi.unstubAllGlobals())

describe('KeysPage bulk revoke', () => {
  it('only offers checkboxes for keys the user may manage', async () => {
    setup()
    await screen.findByText('Alpha')
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Theirs' })).not.toBeInTheDocument()
  })

  it('revokes selected keys sequentially, requiring the count, and reports partial failure', async () => {
    const { user, deletes } = setup()
    await screen.findByText('Alpha')
    await user.click(screen.getByRole('checkbox', { name: 'Select all revocable keys on this page' }))
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' })
    expect(bar).toHaveTextContent('3 selected')
    await user.click(within(bar).getByRole('button', { name: 'Revoke' }))

    const dialog = screen.getByRole('dialog', { name: 'Revoke 3 API keys' })
    const confirm = within(dialog).getByRole('button', { name: 'Revoke' })
    expect(confirm).toBeDisabled()
    // Let the modal's first-frame focus move happen before typing.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    await user.type(within(dialog).getByLabelText('Type "3" to confirm'), '3')
    await user.click(confirm)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 8000 })
    expect(deletes).toEqual(['k1', 'k2', 'k3'])
    expect(await screen.findByText(/Revoked 2 of 3 keys\. 1 failed: "Bravo": Key is owned by a peer admin/)).toBeInTheDocument()
    // The failure stays selected for a retry.
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('1 selected')
    expect(screen.getByRole('checkbox', { name: 'Select Bravo' })).toBeChecked()
  }, 15000)

  it('clears the selection', async () => {
    const { user } = setup()
    await screen.findByText('Alpha')
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).not.toBeChecked()
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).not.toHaveTextContent('selected')
  })
})

describe('KeysPage deep link', () => {
  it('opens the create wizard for ?new=1 and removes the param', async () => {
    setup('/keys?new=1')
    expect(await screen.findByRole('dialog', { name: 'Create API Key' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/keys$/))
  })
})
