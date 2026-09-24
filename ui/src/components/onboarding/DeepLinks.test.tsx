import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import ModelsPage from '../../pages/ModelsPage'
import MCPServersPage from '../../pages/MCPServersPage'
import { OrgMembersPanel } from '../members/OrgMembersPanel'
import { DeepLinkParam } from './DeepLinkParam'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function mockApi(role: 'member' | 'org_admin' | 'system_admin') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      let body: unknown = { data: [], has_more: false }
      if (url.endsWith('/me'))
        body = { id: 'u1', email: 'a@b.c', display_name: 'A', role: role === 'system_admin' ? 'org_admin' : role, org_id: 'o1', is_system_admin: role === 'system_admin' }
      else if (url.includes('mcp-servers') && !url.includes('health')) body = []
      else if (url.includes('/config')) body = { fallback_max_depth: 0 }
      return { ok: true, status: 200, json: () => Promise.resolve(body) }
    }),
  )
}

function renderAt(path: string, ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={ui} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('deep links', () => {
  it('DeepLinkParam fires once, strips only its param, and is inert outside a router', async () => {
    const onMatch = vi.fn()
    renderAt('/x?new=1&tab=a', <DeepLinkParam name="new" onMatch={onMatch} />)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/x\?tab=a$/))
    expect(onMatch).toHaveBeenCalled()
    const outside = vi.fn()
    render(<DeepLinkParam name="new" onMatch={outside} />)
    expect(outside).not.toHaveBeenCalled()
  })

  it('/models?new=1 opens the add-model sheet for system admins', async () => {
    mockApi('system_admin')
    renderAt('/models?new=1', <ModelsPage hideHeader />)
    expect(await screen.findByRole('dialog', { name: 'Add Model' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/models$/))
  })

  it('/models?new=1 does nothing on the read-only catalog', async () => {
    mockApi('member')
    renderAt('/models?new=1', <ModelsPage readOnly hideHeader />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: 'Add Model' })).not.toBeInTheDocument()
  })

  it('/mcp?new=1 opens the add-server sheet', async () => {
    mockApi('org_admin')
    renderAt('/mcp?new=1', <MCPServersPage hideHeader />)
    expect(await screen.findByRole('dialog', { name: 'Add MCP server' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/mcp$/))
  })

  it('/org/users?invite=1 opens the invite dialog for org admins', async () => {
    mockApi('org_admin')
    renderAt('/org/users?invite=1', <OrgMembersPanel orgId="o1" />)
    expect(await screen.findByRole('dialog', { name: 'Invite member' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/org\/users$/))
  })

  it('?invite=1 is ignored for members', async () => {
    mockApi('member')
    renderAt('/org/users?invite=1', <OrgMembersPanel orgId="o1" />)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/me'))).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: 'Invite member' })).not.toBeInTheDocument()
  })
})
