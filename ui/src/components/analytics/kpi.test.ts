import { describe, expect, it } from 'vitest'
import { computeKpiDelta, kpiToneClass } from './kpi'
import { buildKpiSpecs, formatPercent } from './kpiSpecs'
import type { DashboardKpis, DashboardKpiTotals } from '../../hooks/useDashboardKpis'

function totals(overrides: Partial<DashboardKpiTotals> = {}): DashboardKpiTotals {
  return {
    requests: 100,
    errors: 5,
    error_rate: 0.05,
    tokens: 1000,
    cost_usd: 1,
    cache_hits: 10,
    cache_hit_rate: 0.1,
    latency_p50_ms: 200,
    latency_p95_ms: 800,
    ...overrides,
  }
}

describe('computeKpiDelta', () => {
  it('computes relative change with direction and sr text', () => {
    const d = computeKpiDelta(120, 100)
    expect(d.direction).toBe('up')
    expect(d.magnitude).toBeCloseTo(20)
    expect(d.label).toBe('20%')
    expect(d.tone).toBe('good')
    expect(d.srText).toBe('Up 20% vs previous period (better)')
  })

  it('uses one decimal below 10% and handles decreases', () => {
    const d = computeKpiDelta(95, 100)
    expect(d.direction).toBe('down')
    expect(d.label).toBe('5.0%')
    expect(d.tone).toBe('bad')
    expect(d.srText).toContain('Down 5.0%')
  })

  it('treats "up" as bad when lower is better (error rate, latency)', () => {
    const latency = computeKpiDelta(900, 800, { goodWhen: 'down' })
    expect(latency.direction).toBe('up')
    expect(latency.tone).toBe('bad')
    expect(kpiToneClass(latency.tone)).toBe('text-error')
    expect(latency.srText).toMatch(/\(worse\)$/)

    const faster = computeKpiDelta(700, 800, { goodWhen: 'down' })
    expect(faster.tone).toBe('good')
    expect(kpiToneClass(faster.tone)).toBe('text-success')
  })

  it('reports rates in percentage points', () => {
    const d = computeKpiDelta(0.02, 0.01, { kind: 'points', goodWhen: 'down' })
    expect(d.label).toBe('1.0 pts')
    expect(d.direction).toBe('up')
    expect(d.tone).toBe('bad')
    expect(d.srText).toBe('Up 1.0 percentage points vs previous period (worse)')
  })

  it('neutral metrics never get good/bad colour', () => {
    const d = computeKpiDelta(200, 100, { goodWhen: 'neutral' })
    expect(d.direction).toBe('up')
    expect(d.tone).toBe('neutral')
    expect(kpiToneClass(d.tone)).toBe('text-text-tertiary')
    expect(d.srText).toBe('Up 100% vs previous period')
  })

  it('handles zero baselines and no change', () => {
    const fresh = computeKpiDelta(5, 0)
    expect(fresh.isNew).toBe(true)
    expect(fresh.label).toBe('New')
    expect(fresh.magnitude).toBeNull()

    const none = computeKpiDelta(0, 0)
    expect(none.direction).toBe('flat')
    expect(none.tone).toBe('neutral')
    expect(none.srText).toBe('No change vs previous period')

    const same = computeKpiDelta(50, 50, { goodWhen: 'down' })
    expect(same.direction).toBe('flat')
    expect(same.label).toBe('0%')
  })
})

describe('buildKpiSpecs', () => {
  const data: DashboardKpis = {
    current: totals({ requests: 120, error_rate: 0.1, errors: 12, latency_p95_ms: 1000 }),
    previous: totals(),
    granularity: 'hour',
    series: [
      { bucket: '2026-09-24T10:00:00+00:00', requests: 10, errors: 1, tokens: 100, cost_usd: 0.1, latency_p95_ms: 500 },
      { bucket: '2026-09-24T11:00:00+00:00', requests: 0, errors: 0, tokens: 0, cost_usd: 0, latency_p95_ms: 0 },
    ],
  }

  it('builds six KPIs with colour semantics and drill-down links', () => {
    const specs = buildKpiSpecs(data, '24h')
    expect(specs.map((s) => s.id)).toEqual(['requests', 'error_rate', 'latency_p95', 'cache_hit_rate', 'cost', 'tokens'])
    const byId = Object.fromEntries(specs.map((s) => [s.id, s]))

    expect(byId.requests.value).toBe('120')
    expect(byId.requests.delta.tone).toBe('good')
    expect(byId.requests.href).toBe('/usage/logs?range=24h')

    expect(byId.error_rate.value).toBe('10%')
    expect(byId.error_rate.delta.tone).toBe('bad')
    expect(byId.error_rate.delta.label).toBe('5.0 pts')
    expect(byId.error_rate.href).toBe('/usage/logs?status=error&range=24h')
    // error rate per bucket (0 requests -> 0)
    expect(byId.error_rate.trend).toEqual([0.1, 0])

    expect(byId.latency_p95.value).toBe('1,000 ms')
    expect(byId.latency_p95.delta.tone).toBe('bad')

    expect(byId.cache_hit_rate.trend).toEqual([])
    expect(byId.cost.delta.tone).toBe('neutral')
    expect(byId.tokens.trend).toEqual([100, 0])
    expect(byId.requests.trendSummary).toBe('Trend across 2 hours: low 0, high 10, latest 0.')
  })

  it('serializes custom ranges into the logs URL', () => {
    const specs = buildKpiSpecs(data, { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })
    const url = new URL(specs[1].href, 'http://x')
    expect(url.searchParams.get('status')).toBe('error')
    expect(url.searchParams.get('range')).toBe('2026-09-01T00:00:00.000Z..2026-09-02T00:00:00.000Z')
  })

  it('formats percentages', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.0123)).toBe('1.2%')
    expect(formatPercent(0.5)).toBe('50%')
  })
})
