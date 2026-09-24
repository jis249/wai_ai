import { describe, it, expect } from 'vitest'
import {
  getTimeRange,
  granularityForHours,
  parseTimeRange,
  timeRangeKey,
  timeRangeLabel,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from './timeRange'

const NOW = new Date('2026-09-24T12:00:00.000Z')

describe('timeRange', () => {
  it('resolves presets relative to now', () => {
    expect(getTimeRange('24h', NOW)).toEqual({
      from: '2026-09-23T12:00:00.000Z',
      to: '2026-09-24T12:00:00.000Z',
      hours: 24,
      granularity: 'hour',
      preset: '24h',
    })
    expect(getTimeRange('90d', NOW).from).toBe('2026-06-26T12:00:00.000Z')
    expect(getTimeRange('7d', NOW).granularity).toBe('day')
  })

  it('resolves custom ranges and derives granularity from the span', () => {
    const r = getTimeRange({ from: '2026-09-20T00:00:00Z', to: '2026-09-21T00:00:00Z' })
    expect(r).toMatchObject({ hours: 24, granularity: 'hour', preset: null, from: '2026-09-20T00:00:00.000Z' })
    expect(granularityForHours(49)).toBe('day')
  })

  it('round-trips keys through parseTimeRange', () => {
    expect(parseTimeRange(timeRangeKey('30d'))).toBe('30d')
    const custom = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' }
    expect(parseTimeRange(timeRangeKey(custom))).toEqual(custom)
    expect(parseTimeRange('bogus')).toBeNull()
    expect(parseTimeRange(null)).toBeNull()
  })

  it('labels presets in each style', () => {
    expect(timeRangeLabel('7d', 'short')).toBe('7d')
    expect(timeRangeLabel('7d')).toBe('Last 7d')
    expect(timeRangeLabel('7d', 'long')).toBe('Last 7 days')
  })

  it('converts datetime-local values both ways', () => {
    const iso = '2026-09-20T08:30:00.000Z'
    expect(fromDateTimeLocalValue(toDateTimeLocalValue(iso))).toBe(iso)
    expect(fromDateTimeLocalValue('')).toBe('')
  })
})
