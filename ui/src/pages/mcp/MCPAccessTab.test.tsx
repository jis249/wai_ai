import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import MCPAccessTab from '../MCPAccessTab'

const SERVERS = [
  { id: 's1', name: 'GitHub', alias: 'gh' },
  { id: 's2', name: 'Filesystem', alias: 'fs' },
  { id: 's3', name: 'Browser', alias: 'browser' },
]

function setup(savedIds: string[] = [], role = 'org_admin') {
  const puts: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      let body: unknown = {}
      if (url.endsWith('/me')) body = { id: 'u1', email: 'a@b.c', display_name: 'A', role, org_id: 'o1', is_system_admin: false }
      else if (url.includes('/available-mcp-servers')) body = SERVERS
      else if (url.includes('/mcp-access')) {
        if (init?.method === 'PUT') {
          const parsed = JSON.parse(init.body as string)
          puts.push(parsed)
          body = parsed
        } else body = { server_ids: savedIds }
      }
      return { ok: true, status: 200, json: () => Promise.resolve(body) }
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<MCPAccessTab />, { wrapper: Wrapper })
  return { puts }
}

afterEach(() => vi.unstubAllGlobals())

describe('MCPAccessTab', () => {
  it('explains that an empty list allows all global servers', async () => {
    setup([])
    expect(await screen.findByText(/all 3 global servers are allowed/i)).toBeInTheDocument()
    expect(screen.getByText(/empty list means all global servers are allowed/i)).toBeInTheDocument()
  })

  it('shows a Save/Reset bar only when dirty, and Reset discards edits', async () => {
    setup(['s1'])
    const gh = await screen.findByRole('checkbox', { name: /GitHub/ })
    expect(gh).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /Filesystem/ }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('checkbox', { name: /Filesystem/ })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('saves server_ids and supports select all / none with search', async () => {
    const { puts } = setup([])
    await screen.findByRole('checkbox', { name: /GitHub/ })

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search servers' }), 'fil')
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search servers' }))

    expect(screen.getByRole('checkbox', { name: /Filesystem/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /GitHub/ })).not.toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(puts).toEqual([{ server_ids: ['s2'] }]))
    expect(await screen.findByText('MCP access updated')).toBeInTheDocument()
  })

  it('is read-only for non-org-admins', async () => {
    setup([], 'member')
    const gh = await screen.findByRole('checkbox', { name: /GitHub/ })
    expect(gh).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument()
  })
})
