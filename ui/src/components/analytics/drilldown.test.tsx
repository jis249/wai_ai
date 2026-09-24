import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketRange, requestLogsUrl } from './drilldown'
import { alignToAxis, bucketStartMs, buildBucketAxis, previousWindow } from './timeSeries'
import { buildCompareSeries } from './compareSeries'
import { cumulativeMonthSeries, currentUtcMonth } from './budget'
import { TimeSeriesChart } from '../ui/charts/TimeSeriesChart'
import { HorizontalBar } from '../ui/charts/HorizontalBar'
import type { DashboardKpis } from '../../hooks/useDashboardKpis'

const apiClientMock = vi.fn()
vi.mock('../../api/client', () => ({
  default: (endpoint: string) => apiClientMock(endpoint),
}))

const { DashboardKpiRow } = await import('./DashboardKpiRow')

beforeAll(() => {
  // recharts' ResponsiveContainer needs ResizeObserver (not in jsdom)
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

beforeEach(() => apiClientMock.mockReset())

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

describe('requestLogsUrl', () => {
  it('uses the RequestLogsPage param format', () => {
    expect(requestLogsUrl()).toBe('/usage/logs')
    expect(requestLogsUrl({ status: 'error', range: '7d' })).toBe('/usage/logs?status=error&range=7d')
    expect(requestLogsUrl({ model: 'gpt-4o', range: '24h' })).toBe('/usage/logs?model=gpt-4o&range=24h')
    expect(requestLogsUrl({ request: 'req-1' })).toBe('/usage/logs?request=req-1')
    const custom = requestLogsUrl({ range: { from: '2026-09-24T10:00:00.000Z', to: '2026-09-24T11:00:00.000Z' } })
    expect(new URL(custom, 'http://x').searchParams.get('range')).toBe('2026-09-24T10:00:00.000Z..2026-09-24T11:00:00.000Z')
  })

  it('builds a range around a bucket', () => {
    expect(bucketRange('2026-09-24T10:00:00+00:00', 'hour')).toEqual({
      from: '2026-09-24T10:00:00.000Z',
      to: '2026-09-24T11:00:00.000Z',
    })
    expect(bucketRange('2026-09-24', 'day')).toEqual({
      from: '2026-09-24T00:00:00.000Z',
      to: '2026-09-25T00:00:00.000Z',
    })
    expect(bucketRange('garbage', 'day')).toBeUndefined()
  })
})

describe('time series helpers', () => {
  it('parses bucket keys', () => {
    expect(bucketStartMs('2026-09-24')).toBe(Date.parse('2026-09-24T00:00:00Z'))
    expect(bucketStartMs('2026-09-24T10')).toBe(Date.parse('2026-09-24T10:00:00Z'))
  })

  it('computes the previous window and zero-fills an aligned comparison', () => {
    const from = '2026-09-20T00:00:00.000Z'
    const to = '2026-09-23T00:00:00.000Z'
    expect(previousWindow(from, to)).toEqual({ from: '2026-09-17T00:00:00.000Z', to: from })
    const axis = buildBucketAxis(from, to, 'day')
    expect(axis).toHaveLength(3)
    expect(alignToAxis(axis, [{ key: '2026-09-21', value: 4 }], 'day')).toEqual([0, 4, 0])

    const pts = buildCompareSeries({
      from,
      to,
      granularity: 'day',
      current: [{ key: '2026-09-22', value: 2 }],
      previous: [
        { key: '2026-09-17', value: 7 },
        { key: '2026-09-19', value: 1 },
      ],
    })
    expect(pts.map((p) => p.value)).toEqual([0, 0, 2])
    expect(pts.map((p) => p.previous)).toEqual([7, 0, 1])
    expect(pts[0].bucket).toBe('2026-09-20T00:00:00.000Z')
  })

  it('builds a cumulative month-to-date series with future days empty', () => {
    const month = currentUtcMonth(new Date('2026-09-03T12:00:00Z'))
    expect(month.start).toBe('2026-09-01T00:00:00.000Z')
    expect(month.end).toBe('2026-10-01T00:00:00.000Z')
    const pts = cumulativeMonthSeries(month, [
      { key: '2026-09-01', cost: 1 },
      { key: '2026-09-03', cost: 2.5 },
    ])
    expect(pts).toHaveLength(30)
    expect(pts.slice(0, 4).map((p) => p.value)).toEqual([1, 1, 3.5, null])
  })
})

describe('chart drill-down', () => {
  function renderAt(ui: React.ReactNode) {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/usage/logs" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('time-series buckets are keyboard links (one tab stop, arrows move)', async () => {
    const user = userEvent.setup()
    const data = [
      { label: '10:00', tooltipLabel: 'Sep 24, 10:00', value: 3 },
      { label: '11:00', tooltipLabel: 'Sep 24, 11:00', value: 5 },
    ]
    renderAt(
      <TimeSeriesChart
        ariaLabel="Requests per hour"
        data={data}
        getPointHref={(_, i) => requestLogsUrl({ range: bucketRange(i === 0 ? '2026-09-24T10' : '2026-09-24T11', 'hour') })}
        pointActionLabel="view requests"
      />,
    )
    const group = screen.getByRole('group', { name: 'Requests per hour: select a period' })
    const links = within(group).getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('tabindex', '-1')
    expect(links[1]).toHaveAttribute('tabindex', '0')
    expect(links[1]).toHaveAccessibleName('Sep 24, 11:00: 5, view requests')

    await user.tab()
    expect(links[1]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(links[0]).toHaveFocus()
    await user.keyboard('{Enter}')
    const loc = screen.getByTestId('location').textContent ?? ''
    expect(new URL(loc, 'http://x').searchParams.get('range')).toBe('2026-09-24T10:00:00.000Z..2026-09-24T11:00:00.000Z')
  })

  it('bar rows link to the model filter', async () => {
    const user = userEvent.setup()
    renderAt(
      <HorizontalBar
        items={[{ label: 'gpt-4o', value: 10, href: requestLogsUrl({ model: 'gpt-4o', range: '7d' }), linkLabel: 'view requests' }]}
      />,
    )
    await user.click(screen.getByRole('link', { name: /gpt-4o/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/usage/logs?model=gpt-4o&range=7d')
  })
})

describe('DashboardKpiRow', () => {
  const kpis: DashboardKpis = {
    current: {
      requests: 200, errors: 20, error_rate: 0.1, tokens: 5000, cost_usd: 2,
      cache_hits: 50, cache_hit_rate: 0.25, latency_p50_ms: 300, latency_p95_ms: 900,
    },
    previous: {
      requests: 100, errors: 5, error_rate: 0.05, tokens: 5000, cost_usd: 1,
      cache_hits: 10, cache_hit_rate: 0.1, latency_p50_ms: 300, latency_p95_ms: 1000,
    },
    granularity: 'day',
    series: [
      { bucket: '2026-09-23', requests: 80, errors: 5, tokens: 2000, cost_usd: 1, latency_p95_ms: 950 },
      { bucket: '2026-09-24', requests: 120, errors: 15, tokens: 3000, cost_usd: 1, latency_p95_ms: 850 },
    ],
  }

  function renderRow() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<DashboardKpiRow range="7d" from="2026-09-17T00:00:00.000Z" to="2026-09-24T00:00:00.000Z" />} />
            <Route path="/usage/logs" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders KPI tiles with deltas, sparklines and drill-down links', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(kpis)
    renderRow()
    const errorLink = await screen.findByRole('link', { name: /Error rate/ })
    expect(apiClientMock).toHaveBeenCalledWith(
      '/dashboard/kpis?from=2026-09-17T00%3A00%3A00.000Z&to=2026-09-24T00%3A00%3A00.000Z',
    )
    expect(screen.getAllByRole('link')).toHaveLength(6)

    // error rate up = bad (red), with a text alternative
    const errDelta = errorLink.querySelector('[data-slot="delta"]')!
    expect(errDelta).toHaveAttribute('data-tone', 'bad')
    expect(errDelta).toHaveClass('text-error')
    expect(errorLink).toHaveTextContent('Up 5.0 percentage points vs previous period (worse)')

    // latency down = good
    const latency = screen.getByRole('link', { name: /p95 latency/ })
    expect(latency.querySelector('[data-slot="delta"]')).toHaveAttribute('data-tone', 'good')
    expect(latency).toHaveTextContent('900 ms')

    // requests up = good; sparkline decorative with a text summary
    const requests = screen.getByRole('link', { name: /^Requests/ })
    expect(requests.querySelector('[data-slot="delta"]')).toHaveAttribute('data-tone', 'good')
    expect(within(requests).getByTestId('sparkline')).toHaveAttribute('aria-hidden', 'true')
    expect(requests).toHaveTextContent('Trend across 2 days: low 80, high 120, latest 120.')

    // cost / tokens: neutral
    expect(screen.getByRole('link', { name: /Est\. cost/ }).querySelector('[data-slot="delta"]')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByRole('link', { name: /Tokens/ }).querySelector('[data-slot="delta"]')).toHaveTextContent('0%')

    await user.click(errorLink)
    expect(screen.getByTestId('location')).toHaveTextContent('/usage/logs?status=error&range=7d')
  })

  it('shows an error state with retry', async () => {
    const user = userEvent.setup()
    apiClientMock.mockRejectedValueOnce(new Error('kpis down')).mockResolvedValueOnce(kpis)
    renderRow()
    expect(await screen.findByText('kpis down')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: /Error rate/ })).toBeInTheDocument()
  })
})
