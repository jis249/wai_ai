import { useEffect } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequestLogRow, RequestLogsPage as LogsPage } from '../../hooks/useRequestLogs'

const apiClientMock = vi.fn()
vi.mock('../../api/client', () => ({
  default: (endpoint: string, options?: RequestInit) => apiClientMock(endpoint, options),
}))

// Imported after the mock is registered.
const { default: RequestLogsPage } = await import('./RequestLogsPage')

function makeRow(overrides: Partial<RequestLogRow> = {}): RequestLogRow {
  return {
    id: 'req-1',
    created_at: '2026-09-24T10:00:00+00:00',
    status: 200,
    model: 'auto',
    routed_model: 'gpt-4o',
    key_hint: 'wa_uk_ab…cd',
    prompt_tokens: 100,
    completion_tokens: 50,
    cost_usd: 0.0012,
    latency_ms: 420,
    cache_hit: false,
    error: '',
    ...overrides,
  }
}

function page(data: RequestLogRow[], more?: { before: string; id: string }): LogsPage {
  return {
    data,
    has_more: more != null,
    next_before: more?.before ?? '',
    next_before_id: more?.id ?? '',
  }
}

const probe = { search: '' }
function LocationProbe() {
  const loc = useLocation()
  useEffect(() => {
    probe.search = loc.search
  }, [loc.search])
  return null
}

function renderPage(initialUrl = '/usage/logs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <RequestLogsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function lastParams(): URLSearchParams {
  const calls = apiClientMock.mock.calls
  const endpoint = calls[calls.length - 1][0] as string
  expect(endpoint.startsWith('/usage/request-logs?')).toBe(true)
  return new URLSearchParams(endpoint.split('?')[1])
}

beforeEach(() => {
  apiClientMock.mockReset()
  probe.search = ''
})

describe('RequestLogsPage', () => {
  it('renders rows with text status badges, cache hit and error message', async () => {
    apiClientMock.mockResolvedValue(
      page([
        makeRow({ id: 'a', cache_hit: true }),
        makeRow({ id: 'b', status: 502, error: 'upstream timeout', routed_model: '' }),
      ]),
    )
    renderPage()
    expect(await screen.findByText('upstream timeout')).toBeInTheDocument()
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Success')).toBeInTheDocument()
    expect(table.getByText('Error')).toBeInTheDocument()
    expect(table.getByText('Cache hit')).toBeInTheDocument()
    const params = lastParams()
    expect(params.get('limit')).toBe('50')
    expect(params.has('status')).toBe(false)
    expect(params.has('before')).toBe(false)
  })

  it('maps filters to query params and syncs them to the URL', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(page([makeRow()]))
    renderPage()
    await screen.findByText('gpt-4o', { exact: false })

    await user.click(screen.getByRole('button', { name: 'Errors' }))
    await waitFor(() => expect(lastParams().get('status')).toBe('error'))
    expect(new URLSearchParams(probe.search).get('status')).toBe('error')

    await user.type(screen.getByLabelText('Model'), 'gpt-4o')
    await waitFor(() => expect(lastParams().get('model')).toBe('gpt-4o'))
    expect(new URLSearchParams(probe.search).get('model')).toBe('gpt-4o')

    await user.click(screen.getByRole('button', { name: 'Range' }))
    await waitFor(() => expect(lastParams().get('from')).not.toBeNull())
    const p = lastParams()
    const span = new Date(p.get('to')!).getTime() - new Date(p.get('from')!).getTime()
    expect(span).toBe(24 * 3_600_000)
    expect(new URLSearchParams(probe.search).get('range')).toBe('24h')

    await user.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(new URLSearchParams(probe.search).get('range')).toBe('7d'))
    const p7 = lastParams()
    expect(new Date(p7.get('to')!).getTime() - new Date(p7.get('from')!).getTime()).toBe(168 * 3_600_000)
  })

  it('reads initial filters from the URL', async () => {
    apiClientMock.mockResolvedValue(page([]))
    renderPage('/usage/logs?status=success&model=claude&key_id=k1')
    await screen.findByText('No matching requests')
    const params = lastParams()
    expect(params.get('status')).toBe('success')
    expect(params.get('model')).toBe('claude')
    expect(params.get('key_id')).toBe('k1')
    expect(screen.getByLabelText('Model')).toHaveValue('claude')
  })

  it('loads the next page with the cursor from the previous response', async () => {
    const user = userEvent.setup()
    apiClientMock
      .mockResolvedValueOnce(page([makeRow({ id: 'a', routed_model: 'first-model' })], { before: '2026-09-24T09:00:00+00:00', id: 'a' }))
      .mockResolvedValueOnce(page([makeRow({ id: 'b', routed_model: 'second-model' })]))
    renderPage()
    await screen.findByText('first-model', { exact: false })

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('second-model', { exact: false })
    const params = lastParams()
    expect(params.get('before')).toBe('2026-09-24T09:00:00+00:00')
    expect(params.get('before_id')).toBe('a')
    expect(screen.getByText('first-model', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(screen.getByText('End of results')).toBeInTheDocument()
  })

  it('opens a detail sheet for a row', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(
      page([makeRow({ id: 'req-xyz', status: 500, error: 'boom', prompt_tokens: 12, completion_tokens: 3 })]),
    )
    renderPage()
    await screen.findByText('boom')
    await user.click(screen.getByRole('button', { name: /view details for request/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    const d = within(dialog)
    expect(d.getByText('req-xyz')).toBeInTheDocument()
    expect(d.getByText('Requested model').nextSibling).toHaveTextContent('auto')
    expect(d.getByText('Routed model').nextSibling).toHaveTextContent('gpt-4o')
    expect(d.getByText('Total tokens').nextSibling).toHaveTextContent('15')
    expect(d.getByText('boom')).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Copy request ID' })).toBeInTheDocument()

    await user.click(d.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an error state with retry instead of "no data"', async () => {
    const user = userEvent.setup()
    apiClientMock.mockRejectedValueOnce(new Error('backend down')).mockResolvedValueOnce(page([makeRow()]))
    renderPage()
    expect(await screen.findByText('backend down')).toBeInTheDocument()
    expect(screen.queryByText('No requests yet')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('gpt-4o', { exact: false })
  })

  it('shows the getting-started empty state with a curl snippet when there are no logs', async () => {
    apiClientMock.mockResolvedValue(page([]))
    renderPage()
    expect(await screen.findByText('No requests yet')).toBeInTheDocument()
    expect(screen.getByText(/curl http:\/\/localhost:8081\/v1\/chat\/completions/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy curl example' })).toBeInTheDocument()
  })
})
