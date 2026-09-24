import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import MCPServersPage from '../MCPServersPage'

function server(over: Record<string, unknown>) {
  return {
    id: 'x', name: 'x', alias: 'x', url: 'https://x.example.com/mcp', auth_type: 'none', source: 'api',
    scope: 'org', org_id: 'o1', is_active: true, code_mode_enabled: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}

const SERVERS = [
  server({ id: 'g1', name: 'Global Search', alias: 'gsearch', scope: 'global', org_id: undefined }),
  server({ id: 'o1s', name: 'Org GitHub', alias: 'gh', url: 'https://gh.example.com/mcp' }),
]

function setup(payload: unknown = SERVERS, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      let body: unknown = []
      if (url.endsWith('/me')) body = { id: 'u1', email: 'a@b.c', display_name: 'A', role: 'org_admin', org_id: 'o1', is_system_admin: false }
      else if (url.includes('/orgs/o1/mcp-servers')) {
        if (!ok) return { ok: false, status: 500, json: () => Promise.resolve({ error: { message: 'boom' } }) }
        body = payload
      }
      return { ok: true, status: 200, json: () => Promise.resolve(body) }
    }),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<MCPServersPage hideHeader />, { wrapper: Wrapper })
}

afterEach(() => vi.unstubAllGlobals())

describe('MCPServersPage', () => {
  it('hides write actions on global servers for org admins', async () => {
    setup()
    await screen.findByText('Org GitHub')
    expect(screen.getByRole('button', { name: 'More actions for Org GitHub' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions for Global Search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test connection to Global Search' })).not.toBeInTheDocument()
  })

  it('filters by alias/url and shows an empty state when nothing matches', async () => {
    setup()
    await screen.findByText('Org GitHub')
    const search = screen.getByRole('searchbox', { name: 'Search servers' })
    await userEvent.type(search, 'gsearch')
    expect(screen.getByText('Global Search')).toBeInTheDocument()
    expect(screen.queryByText('Org GitHub')).not.toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'nomatch')
    expect(screen.getByText('No matching servers')).toBeInTheDocument()
  })

  it('shows an error state with retry', async () => {
    setup(SERVERS, false)
    expect(await screen.findByText("Couldn't load MCP servers")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
