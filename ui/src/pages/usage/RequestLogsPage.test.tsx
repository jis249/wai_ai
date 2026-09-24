import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// ---------------------------------------------------------------------------
// Deep link, keyboard navigation, live tail
// ---------------------------------------------------------------------------

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table')
  return within(table).getAllByRole('row').slice(1) // skip header
}

describe('RequestLogsPage deep link (?request=)', () => {
  it('opens the detail sheet when the request is loaded', async () => {
    apiClientMock.mockResolvedValue(page([makeRow({ id: 'a' }), makeRow({ id: 'req-deep', error: 'deep error' })]))
    renderPage('/usage/logs?request=req-deep')
    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    expect(within(dialog).getByText('req-deep')).toBeInTheDocument()
    expect(screen.queryByText(/not in the loaded range/)).not.toBeInTheDocument()

    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(new URLSearchParams(probe.search).has('request')).toBe(false))
  })

  it('shows a banner when the request is not in the loaded range', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(page([makeRow({ id: 'a' })]))
    renderPage('/usage/logs?request=missing-1&range=24h')
    expect(await screen.findByText('Request missing-1 not in the loaded range')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/not in the loaded range/)).not.toBeInTheDocument())
    const params = new URLSearchParams(probe.search)
    expect(params.has('request')).toBe(false)
    expect(params.get('range')).toBe('24h')
  })

  it('opening a row puts its id in the URL', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(page([makeRow({ id: 'row-9' })]))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /view details for request/i }))
    await screen.findByRole('dialog', { name: 'Request details' })
    expect(new URLSearchParams(probe.search).get('request')).toBe('row-9')
  })
})

describe('RequestLogsPage keyboard', () => {
  it('j / k move between rows and Enter opens details', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(
      page([
        makeRow({ id: 'r1', routed_model: 'model-one' }),
        makeRow({ id: 'r2', routed_model: 'model-two' }),
        makeRow({ id: 'r3', routed_model: 'model-three' }),
      ]),
    )
    renderPage()
    await screen.findByText('model-one', { exact: false })
    const buttons = screen.getAllByRole('button', { name: /view details for request/i })
    buttons[0].focus()

    await user.keyboard('j')
    expect(buttons[1]).toHaveFocus()
    await user.keyboard('j')
    expect(buttons[2]).toHaveFocus()
    await user.keyboard('j') // stays on the last row
    expect(buttons[2]).toHaveFocus()
    await user.keyboard('k')
    expect(buttons[1]).toHaveFocus()

    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    expect(within(dialog).getByText('r2')).toBeInTheDocument()
  })

  it('j / k keydown is marked handled so global shortcuts do not fire', async () => {
    apiClientMock.mockResolvedValue(page([makeRow({ id: 'r1' }), makeRow({ id: 'r2' })]))
    renderPage()
    const [first] = await screen.findAllByRole('button', { name: /view details for request/i })
    const seen: boolean[] = []
    const listener = (e: KeyboardEvent) => seen.push(e.defaultPrevented)
    document.addEventListener('keydown', listener)
    fireEvent.keyDown(first, { key: 'j' })
    document.removeEventListener('keydown', listener)
    expect(seen).toEqual([true])
    // outside the table, j is left alone
    fireEvent.keyDown(document.body, { key: 'j' })
  })
})

describe('RequestLogsPage live tail', () => {
  const liveQueue: LogsPage[] = []
  let liveCalls: URLSearchParams[] = []

  function setup(initial: LogsPage) {
    liveQueue.length = 0
    liveCalls = []
    apiClientMock.mockImplementation((endpoint: string) => {
      const params = new URLSearchParams(endpoint.split('?')[1])
      if (params.has('after')) {
        liveCalls.push(params)
        return Promise.resolve(liveQueue.shift() ?? page([]))
      }
      return Promise.resolve(initial)
    })
  }

  function livePage(rows: RequestLogRow[]): LogsPage {
    return { ...page(rows), latest_created_at: rows[0]?.created_at ?? '', latest_id: rows[0]?.id ?? '' }
  }

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('polls with after/after_id from the newest row and prepends new rows with a highlight', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(page([makeRow({ id: 'old', created_at: '2026-09-24T10:00:00+00:00', routed_model: 'old-model' })]))
    renderPage('/usage/logs?status=error')
    await screen.findByText('old-model', { exact: false })

    liveQueue.push(livePage([makeRow({ id: 'new1', created_at: '2026-09-24T10:00:05+00:00', routed_model: 'new-model' })]))
    await user.click(screen.getByRole('switch', { name: 'Live tail' }))
    expect(screen.getByRole('status')).toHaveTextContent('Live')

    await screen.findByText('new-model', { exact: false })
    expect(liveCalls[0].get('after')).toBe('2026-09-24T10:00:00+00:00')
    expect(liveCalls[0].get('after_id')).toBe('old')
    expect(liveCalls[0].get('status')).toBe('error')
    const rows = bodyRows()
    expect(rows[0]).toHaveTextContent('new-model')
    expect(rows[0]).toHaveAttribute('data-highlighted', 'true')
    expect(rows[1]).toHaveTextContent('old-model')

    // Next poll 3s later advances the cursor to the newest row
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(liveCalls).toHaveLength(2)
    expect(liveCalls[1].get('after')).toBe('2026-09-24T10:00:05+00:00')
    expect(liveCalls[1].get('after_id')).toBe('new1')

    // highlight fades
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(bodyRows()[0]).not.toHaveAttribute('data-highlighted')
  })

  it('pauses (buffers) while a detail sheet is open and shows rows after it closes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(page([makeRow({ id: 'old', routed_model: 'old-model' })]))
    renderPage()
    await screen.findByText('old-model', { exact: false })
    await user.click(screen.getByRole('switch', { name: 'Live tail' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await user.click(screen.getByRole('button', { name: /view details for request/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    expect(screen.getByText('Paused while viewing details')).toBeInTheDocument()

    liveQueue.push(livePage([makeRow({ id: 'during', created_at: '2026-09-24T10:01:00+00:00', routed_model: 'during-model' })]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(liveCalls.length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('during-model', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 new — jump to top' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await screen.findByText('during-model', { exact: false })
    expect(bodyRows()[0]).toHaveTextContent('during-model')
    expect(screen.queryByRole('button', { name: /new — jump to top/ })).not.toBeInTheDocument()
  })

  it('auto-pauses when scrolled down and the pill jumps back to the top', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(page([makeRow({ id: 'old', routed_model: 'old-model' })]))
    renderPage()
    await screen.findByText('old-model', { exact: false })
    await user.click(screen.getByRole('switch', { name: 'Live tail' }))

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByText('Paused (scrolled down)')).toBeInTheDocument()

    liveQueue.push(
      livePage([
        makeRow({ id: 'n2', created_at: '2026-09-24T10:02:00+00:00', routed_model: 'n2-model' }),
        makeRow({ id: 'n1', created_at: '2026-09-24T10:01:00+00:00', routed_model: 'n1-model' }),
      ]),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    const pill = await screen.findByRole('button', { name: '2 new — jump to top' })
    expect(screen.queryByText('n2-model', { exact: false })).not.toBeInTheDocument()

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    await user.click(pill)
    expect(scrollTo).toHaveBeenCalled()
    scrollTo.mockRestore()
    await screen.findByText('n2-model', { exact: false })
    const rows = bodyRows()
    expect(rows[0]).toHaveTextContent('n2-model')
    expect(rows[1]).toHaveTextContent('n1-model')
    expect(rows[2]).toHaveTextContent('old-model')
  })

  it('stops polling while the tab is hidden and resumes when visible', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(page([makeRow({ id: 'old' })]))
    renderPage()
    await screen.findByText('gpt-4o', { exact: false })
    await user.click(screen.getByRole('switch', { name: 'Live tail' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    const before = liveCalls.length
    expect(before).toBeGreaterThanOrEqual(2)

    setVisibility('hidden')
    expect(screen.getByText('Paused (tab hidden)')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(liveCalls).toHaveLength(before)

    setVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(liveCalls.length).toBe(before + 1)
  })

  it('stops polling when switched off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(page([makeRow({ id: 'old' })]))
    renderPage()
    await screen.findByText('gpt-4o', { exact: false })
    const toggle = screen.getByRole('switch', { name: 'Live tail' })
    await user.click(toggle)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await user.click(toggle)
    const count = liveCalls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(liveCalls).toHaveLength(count)
  })
})
