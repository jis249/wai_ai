import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import { ServerToolsList } from './ServerToolsList'

const TOOLS = [
  { name: 'read_file', description: 'Read a file', blocked: false },
  { name: 'delete_file', description: 'Delete a file', blocked: true },
]

function renderList(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  return { queryClient, ...render(<ServerToolsList serverId="srv-1" canEdit={canEdit} />, { wrapper: Wrapper }) }
}

type Handler = (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown } | Promise<{ ok: boolean; status: number; body: unknown }>

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await handler(String(input), init)
    return {
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body),
      text: () => Promise.resolve(JSON.stringify(res.body)),
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ServerToolsList', () => {
  it('marks blocked tools with text and hides controls for read-only users', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: TOOLS }))
    renderList(false)
    const row = (await screen.findByText('delete_file')).closest('li')!
    expect(within(row).getByText('Blocked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /block tool/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh tools/i })).not.toBeInTheDocument()
  })

  it('optimistically blocks a tool and sends the blocklist POST', async () => {
    let resolvePost: (v: { ok: boolean; status: number; body: unknown }) => void = () => {}
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method === 'POST') return new Promise((r) => (resolvePost = r))
      return { ok: true, status: 200, body: TOOLS }
    })
    renderList()
    const btn = await screen.findByRole('button', { name: 'Block tool read_file' })
    await userEvent.click(btn)

    // Optimistic: the row flips to "Blocked" before the server responds.
    const row = screen.getByText('read_file').closest('li')!
    await waitFor(() => expect(within(row).getByText('Blocked')).toBeInTheDocument())

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(String(post[0])).toContain('/api/v1/mcp-servers/srv-1/blocklist')
    expect(JSON.parse(post[1]!.body as string)).toEqual({ tool_name: 'read_file', reason: '' })

    resolvePost({ ok: true, status: 200, body: {} })
    expect(await screen.findByText('Tool "read_file" blocked')).toBeInTheDocument()
  })

  it('rolls back the optimistic change and toasts on error', async () => {
    mockFetch((_url, init) => {
      if (init?.method === 'DELETE') return { ok: false, status: 403, body: { error: { message: 'forbidden' } } }
      return { ok: true, status: 200, body: TOOLS }
    })
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: 'Unblock tool delete_file' }))
    // Error toast appears and the tool is still shown as blocked.
    expect(await screen.findByText('forbidden')).toBeInTheDocument()
    const row = screen.getByText('delete_file').closest('li')!
    await waitFor(() => expect(within(row).getByText('Blocked')).toBeInTheDocument())
    expect(within(row).getByRole('button', { name: 'Unblock tool delete_file' })).toBeInTheDocument()
  })

  it('filters tools by search when the list is long', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `tool_${i}`, description: '', blocked: false }))
    mockFetch(() => ({ ok: true, status: 200, body: many }))
    renderList()
    const search = await screen.findByRole('searchbox', { name: 'Search tools' })
    await userEvent.type(search, 'tool_3')
    expect(screen.getByText('tool_3')).toBeInTheDocument()
    expect(screen.queryByText('tool_1')).not.toBeInTheDocument()
  })
})
