import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { GettingStarted } from './GettingStarted'
import type { OnboardingStatus } from '../../hooks/useOnboardingStatus'

const NONE: OnboardingStatus = { has_models: false, has_keys: false, has_requests: false, has_budget: false, has_members: false }

function setup(role: 'member' | 'org_admin' | 'system_admin', status: OnboardingStatus | 'error' = NONE) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: 'x', json: () => Promise.resolve(body) })
      if (url.endsWith('/me'))
        return json({ id: 'u1', email: 'a@b.c', display_name: 'A', role: role === 'system_admin' ? 'org_admin' : role, org_id: 'o1', is_system_admin: role === 'system_admin' })
      if (url.endsWith('/onboarding/status')) return status === 'error' ? json({ error: { message: 'nope' } }, 500) : json(status)
      if (url.endsWith('/me/available-models')) return json({ models: [{ name: 'gpt-4o', type: 'chat' }] })
      return json({})
    }),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GettingStarted />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, user: userEvent.setup() }
}

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

const stepIds = () => screen.getAllByTestId(/^onboarding-step-/).map((el) => el.dataset.testid?.replace('onboarding-step-', ''))

describe('GettingStarted', () => {
  it('shows every step to system admins with deep links and a copyable curl', async () => {
    setup('system_admin')
    await screen.findByTestId('onboarding-step-model')
    expect(stepIds()).toEqual(['model', 'key', 'request', 'budget', 'invite'])
    expect(screen.getByRole('link', { name: /Add model/ })).toHaveAttribute('href', '/models?new=1')
    expect(screen.getByRole('link', { name: /Create key/ })).toHaveAttribute('href', '/keys?new=1')
    expect(screen.getByRole('link', { name: /Open playground/ })).toHaveAttribute('href', '/playground')
    expect(screen.getByRole('link', { name: /Set budget/ })).toHaveAttribute('href', '/org/settings')
    expect(screen.getByRole('link', { name: /View members/ })).toHaveAttribute('href', '/org/users')
    expect(screen.getByRole('button', { name: 'Copy curl command' })).toBeInTheDocument()
    const code = screen.getByText(/chat\/completions/).textContent ?? ''
    expect(code).toContain('/v1/chat/completions')
    expect(code).toContain('"model": "gpt-4o"')
  })

  it('hides admin-only steps from members', async () => {
    setup('member')
    await screen.findByTestId('onboarding-step-key')
    expect(stepIds()).toEqual(['key', 'request'])
  })

  it('hides the model step from org admins', async () => {
    setup('org_admin')
    await screen.findByTestId('onboarding-step-key')
    expect(stepIds()).toEqual(['key', 'request', 'budget', 'invite'])
  })

  it('ticks steps from the status endpoint and shows progress', async () => {
    setup('org_admin', { ...NONE, has_keys: true, has_budget: true })
    const bar = await screen.findByRole('progressbar', { name: 'Setup progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '4')
    expect(screen.getByText('2 of 4 complete')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-step-key')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('onboarding-step-invite')).toHaveAttribute('data-done', 'false')
    expect(screen.queryByRole('link', { name: /Create key/ })).not.toBeInTheDocument()
  })

  it('hides itself when every visible step is done (ignoring steps the role cannot see)', async () => {
    // Member: only key + request are visible; models/budget/members being false must not matter.
    const { container } = setup('member', { ...NONE, has_keys: true, has_requests: true })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/onboarding/status'))).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('can be dismissed and stays dismissed', async () => {
    const first = setup('member')
    await first.user.click(await screen.findByRole('button', { name: 'Dismiss getting started' }))
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()
    first.unmount()
    setup('member')
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/me'))).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()
  })

  it('still works when localStorage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = setup('member')
    await user.click(await screen.findByRole('button', { name: 'Dismiss getting started' }))
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()
    spy.mockRestore()
    set.mockRestore()
  })

  it('shows an error state with retry when status fails', async () => {
    setup('member', 'error')
    expect(await screen.findByText("Couldn't load setup progress")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })
})
