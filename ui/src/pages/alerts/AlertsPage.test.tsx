import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import AlertsPage from './AlertsPage'

type Handler = (url: string, method: string, body: unknown) => { status?: number; body?: unknown } | undefined

interface Call {
  url: string
  method: string
  body: unknown
}

const ME_ORG_ADMIN = { id: 'u1', email: 'a@x.io', display_name: 'A', role: 'org_admin', org_id: 'org-a', is_system_admin: false }
const ME_SYS = { ...ME_ORG_ADMIN, role: 'system_admin', is_system_admin: true }
const ME_MEMBER = { ...ME_ORG_ADMIN, role: 'member' }

const CHANNELS = [
  {
    id: 'c1',
    org_id: 'org-a',
    name: 'Ops Teams',
    kind: 'teams',
    url_hint: 'prod-01.westus.logic.azure.com/workflows/****',
    has_secret: false,
    enabled: true,
    created_by: 'u1',
    created_at: '2026-09-01T00:00:00+00:00',
    updated_at: '2026-09-01T00:00:00+00:00',
  },
]

const RULES = [
  {
    kind: 'budget.threshold',
    org_id: 'org-a',
    enabled: true,
    severity_min: 'warning',
    cooldown_seconds: 86400,
    params: { thresholds: [80, 100] },
    channel_ids: [],
    updated_at: '2026-09-01T00:00:00+00:00',
  },
  {
    kind: 'error_rate.high',
    org_id: 'org-a',
    enabled: true,
    severity_min: 'warning',
    cooldown_seconds: 3600,
    params: { threshold_pct: 10, min_requests: 20, window_minutes: 15 },
    channel_ids: [],
    updated_at: '2026-09-01T00:00:00+00:00',
  },
]

const EVENTS = {
  data: [
    {
      id: 'e1',
      org_id: 'org-a',
      kind: 'budget.threshold',
      severity: 'critical',
      title: "Organization 'A' reached 100% of its monthly budget",
      message: 'Month-to-date spend is $100.00',
      data: {},
      created_at: '2026-09-10T00:00:00+00:00',
      delivery: [{ channel_id: 'c1', name: 'Ops Teams', kind: 'teams', ok: true, status: 200, error: '', attempts: 1 }],
    },
  ],
  has_more: false,
}

function setup(me: unknown, handler?: Handler) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      calls.push({ url, method, body })
      const custom = handler?.(url, method, body)
      let res: { status?: number; body?: unknown }
      if (custom) res = custom
      else if (url.endsWith('/api/v1/me')) res = { body: me }
      else if (url.includes('/alerts/channels') && method === 'GET') res = { body: { data: CHANNELS } }
      else if (url.includes('/alerts/rules') && method === 'GET') res = { body: { data: RULES } }
      else if (url.includes('/alerts/events')) res = { body: EVENTS }
      else if (url.includes('/orgs')) res = { body: { data: [{ id: 'org-b', name: 'Org B' }], has_more: false } }
      else res = { body: {} }
      const status = res.status ?? 200
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: 'x',
        json: () => Promise.resolve(res.body),
      }
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<AlertsPage />, { wrapper: Wrapper })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AlertsPage', () => {
  it('lists org channels with masked URL, rules and events for an org admin', async () => {
    const calls = setup(ME_ORG_ADMIN)
    const list = await screen.findByRole('list', { name: 'Alert channels' })
    expect(within(list).getByText('Ops Teams')).toBeInTheDocument()
    expect(screen.getByText('prod-01.westus.logic.azure.com/workflows/****')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Alert scope' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Budget thresholds' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'High error rate' })).toBeInTheDocument()
    expect(await screen.findByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('Delivered 1/1')).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/alerts/channels?org_id=org-a'))).toBe(true)
    expect(calls.some((c) => c.url.includes('/orgs'))).toBe(false)
  })

  it('adds a Slack channel from the sheet', async () => {
    const user = userEvent.setup()
    const calls = setup(ME_ORG_ADMIN, (url, method) =>
      url.endsWith('/alerts/channels') && method === 'POST'
        ? { status: 201, body: { ...CHANNELS[0], id: 'c2', name: 'Eng Slack', kind: 'slack' } }
        : undefined,
    )
    await screen.findByRole('list', { name: 'Alert channels' })
    await user.click(screen.getAllByRole('button', { name: 'Add channel' })[0])
    const sheet = await screen.findByRole('dialog', { name: 'Add channel' })
    await user.click(within(sheet).getByRole('button', { name: 'Slack' }))
    await user.click(within(sheet).getByRole('button', { name: 'Add channel' }))
    expect(within(sheet).getByText('Name is required')).toBeInTheDocument()
    await user.type(within(sheet).getByLabelText('Name'), 'Eng Slack')
    await user.type(within(sheet).getByLabelText('URL'), 'https://hooks.slack.com/services/T/B/X')
    await user.click(within(sheet).getByRole('button', { name: 'Add channel' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({
      name: 'Eng Slack',
      kind: 'slack',
      url: 'https://hooks.slack.com/services/T/B/X',
      enabled: true,
      org_id: 'org-a',
    })
    expect(await screen.findByText('Channel "Eng Slack" added')).toBeInTheDocument()
  })

  it('shows the test result in a toast', async () => {
    const user = userEvent.setup()
    setup(ME_ORG_ADMIN, (url, method) =>
      url.includes('/test') && method === 'POST'
        ? { body: { ok: false, status: 403, error: 'HTTP 403', attempts: 1, ms: 20, event_id: 'e9' } }
        : undefined,
    )
    await user.click(await screen.findByRole('button', { name: 'Send test alert to Ops Teams' }))
    expect(await screen.findByText('Test to Ops Teams failed: HTTP 403')).toBeInTheDocument()
  })

  it('deletes a channel after confirmation', async () => {
    const user = userEvent.setup()
    const calls = setup(ME_ORG_ADMIN, (_url, method) => (method === 'DELETE' ? { status: 204 } : undefined))
    await user.click(await screen.findByRole('button', { name: 'Delete Ops Teams' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete channel' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/alerts/channels/c1'))).toBe(true))
  })

  it('saves rule changes with validated params', async () => {
    const user = userEvent.setup()
    const calls = setup(ME_ORG_ADMIN, (_url, method, body) =>
      method === 'PUT' ? { body: { ...RULES[1], ...(body as object), updated_at: 'later' } } : undefined,
    )
    const form = (await screen.findByRole('heading', { name: 'High error rate' })).closest('form')!
    const pct = within(form).getByLabelText('Error rate threshold (%)')
    await user.clear(pct)
    await user.type(pct, '250')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('between 0.1 and 100')
    await user.clear(pct)
    await user.type(pct, '25')
    await user.click(within(form).getByRole('checkbox', { name: /Ops Teams/ }))
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toContain('/alerts/rules/error_rate.high?org_id=org-a')
    expect(put.body).toMatchObject({
      enabled: true,
      params: { threshold_pct: 25, min_requests: 20, window_minutes: 15 },
      channel_ids: ['c1'],
    })
  })

  it('shows empty and error states', async () => {
    setup(ME_ORG_ADMIN, (url, method) => {
      if (url.includes('/alerts/channels') && method === 'GET') return { body: { data: [] } }
      if (url.includes('/alerts/events')) return { status: 500, body: { error: { message: 'boom' } } }
      return undefined
    })
    expect(await screen.findByText('No channels yet')).toBeInTheDocument()
    expect(await screen.findByText("Couldn't load events")).toBeInTheDocument()
  })

  it('blocks members', async () => {
    setup(ME_MEMBER)
    expect(await screen.findByText('Organization admins only')).toBeInTheDocument()
  })

  it('lets system admins switch between platform and organization scope', async () => {
    const user = userEvent.setup()
    const calls = setup(ME_SYS)
    const scope = await screen.findByRole('group', { name: 'Alert scope' })
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/v1/alerts/channels'))).toBe(true))
    await user.click(within(scope).getByRole('button', { name: 'Organization' }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/alerts/channels?org_id=org-a'))).toBe(true))
  })
})
