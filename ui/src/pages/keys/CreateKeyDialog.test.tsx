import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import { CreateKeyDialog } from './CreateKeyDialog'

interface Call {
  url: string
  method: string
  body?: unknown
}

const ME = { id: 'u1', email: 'a@b.c', display_name: 'A', role: 'member', org_id: 'o1', is_system_admin: false }

function setup({ canEditLimits = false, teams = [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }] } = {}) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      let body: unknown = {}
      if (url.endsWith('/me')) body = ME
      else if (url.includes('/orgs/o1/teams')) body = { data: teams, has_more: false }
      else if (url.includes('/orgs/o1/service-accounts')) body = { data: [], has_more: false }
      else if (url.endsWith('/me/available-models')) body = { models: [{ name: 'gpt-4o', type: 'chat' }, { name: 'claude', type: 'chat' }] }
      else if (url.endsWith('/orgs/o1/keys') && method === 'POST') body = { id: 'k1', key: 'wa_uk_secret', name: 'CI' }
      return { ok: true, status: 200, json: () => Promise.resolve(body) }
    }),
  )
  const onCreated = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(['me'], ME)
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<CreateKeyDialog open onClose={() => {}} onCreated={onCreated} orgId="o1" canEditLimits={canEditLimits} />, {
    wrapper: Wrapper,
  })
  return { calls, onCreated, user: userEvent.setup() }
}

afterEach(() => vi.unstubAllGlobals())

// The modal moves focus to its first control on the next animation frame; let that happen
// before typing so it can't steal keystrokes.
const settle = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))

const next = () => screen.getByRole('button', { name: 'Next' })

describe('CreateKeyDialog wizard', () => {
  it('validates the details step before moving on', async () => {
    const { user } = setup()
    await settle()
    await screen.findByRole('combobox', { name: 'Team' })
    await user.click(next())
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Select a team for this key')).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Details' })).toBeInTheDocument()
  })

  it('requires at least one model when restricting access', async () => {
    const { user } = setup({ teams: [] })
    await settle()
    await user.type(screen.getByLabelText('Name'), 'CI')
    await user.click(next())
    expect(screen.getByText('All models the org allows')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Only specific models/ }))
    await screen.findByRole('checkbox', { name: 'gpt-4o' })
    await user.click(next())
    expect(screen.getByText('Select at least one model, or allow all models')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'gpt-4o' }))
    await user.click(next())
    expect(screen.getByRole('form', { name: 'Review' })).toBeInTheDocument()
  })

  it('skips the limits step for non-admins and sends the user key with its team', async () => {
    const { user, calls, onCreated } = setup()
    await settle()
    // Three steps only: no "Limits & expiry" for non-admins.
    expect(screen.getAllByText(/Step \d:/).map((n) => n.textContent)).toEqual([
      'Step 1: Details (current step)',
      'Step 2: Access',
      'Step 3: Review',
    ])
    await user.type(screen.getByLabelText('Name'), '  CI  ')
    await user.click(await screen.findByRole('combobox', { name: 'Team' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    await user.click(screen.getByRole('combobox', { name: 'Expires in' }))
    await user.click(screen.getByRole('option', { name: 'Never' }))
    await user.click(next())
    await user.click(next())
    const review = screen.getByRole('form', { name: 'Review' })
    expect(review).toHaveTextContent('Beta')
    expect(review).toHaveTextContent('All models the org allows')
    expect(review).not.toHaveTextContent('Limits')
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('wa_uk_secret', expect.objectContaining({ id: 'k1' })))
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ name: 'CI', key_type: 'user_key', user_id: 'u1', team_id: 't2' })
    expect(calls.some((c) => c.url.includes('model-access'))).toBe(false)
  })

  it('lets admins set limits, validates them, and includes them in the request', async () => {
    const { user, calls } = setup({ canEditLimits: true, teams: [] })
    await settle()
    await user.type(screen.getByLabelText('Name'), 'CI')
    expect(screen.queryByRole('combobox', { name: 'Expires in' })).not.toBeInTheDocument()
    await user.click(next())
    await user.click(screen.getByRole('radio', { name: /Only specific models/ }))
    await user.click(await screen.findByRole('checkbox', { name: 'claude' }))
    await user.click(next())
    expect(screen.getByRole('form', { name: 'Limits & expiry' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Requests per Minute'), '60')
    await user.type(screen.getByLabelText('Daily Token Limit'), '1000')
    await user.click(next())
    expect(screen.getByRole('form', { name: 'Review' })).toHaveTextContent('Requests / minute: 60')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Requests per Minute')).toHaveValue(60)
    await user.click(next())
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/keys/k1/model-access'))).toBe(true))
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toMatchObject({ name: 'CI', key_type: 'user_key', user_id: 'u1', requests_per_minute: 60, daily_token_limit: 1000 })
    expect(typeof (post?.body as { expires_at?: unknown }).expires_at).toBe('string')
    expect(calls.find((c) => c.url.includes('model-access'))?.body).toEqual({ models: ['claude'] })
  })
})
