import { describe, it, expect } from 'vitest'
import type { APIKeyResponse } from '../../hooks/useAPIKeys'
import { filterKeys, keyActions, keyOwnerLabel, keyStatus, nextSort, sortKeys, validateLimits } from './helpers'
import type { KeyStatusFilter, OwnerContext } from './helpers'

const NOW = Date.parse('2026-09-24T00:00:00Z')
const DAY = 86400000

function key(p: Partial<APIKeyResponse>): APIKeyResponse {
  return {
    id: 'k',
    key_hint: 'abcd',
    key_type: 'user_key',
    name: 'key',
    org_id: 'o',
    team_id: null,
    user_id: 'me',
    service_account_id: null,
    daily_token_limit: 0,
    monthly_token_limit: 0,
    requests_per_minute: 0,
    requests_per_day: 0,
    expires_at: null,
    last_used_at: null,
    created_by: 'me',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...p,
  }
}

const owner: OwnerContext = {
  meId: 'me',
  teamNames: new Map([['t1', 'Platform']]),
  serviceAccountNames: new Map([['sa1', 'ci-bot']]),
}

describe('keys helpers', () => {
  it('derives status', () => {
    expect(keyStatus(key({}), NOW)).toBe('active')
    expect(keyStatus(key({ expires_at: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toBe('expiring')
    expect(keyStatus(key({ expires_at: new Date(NOW - DAY).toISOString() }), NOW)).toBe('expired')
    expect(keyStatus(key({ expires_at: new Date(NOW + 30 * DAY).toISOString() }), NOW)).toBe('active')
  })

  it('labels owners from known data', () => {
    expect(keyOwnerLabel(key({}), owner)).toBe('You')
    expect(keyOwnerLabel(key({ key_type: 'team_key', team_id: 't1', user_id: null }), owner)).toBe('Platform')
    expect(keyOwnerLabel(key({ key_type: 'sa_key', service_account_id: 'sa1', user_id: null }), owner)).toBe('ci-bot')
    expect(keyOwnerLabel(key({ user_id: '1234567890' }), owner)).toBe('User 12345678')
  })

  it('filters by name, hint, owner and status', () => {
    const keys = [
      key({ id: 'a', name: 'Prod backend' }),
      key({ id: 'b', name: 'Other', key_hint: 'zz99', expires_at: new Date(NOW - DAY).toISOString() }),
      key({ id: 'c', name: 'Bot', key_type: 'sa_key', service_account_id: 'sa1', user_id: null }),
    ]
    const f = (query: string, status: KeyStatusFilter = 'all') =>
      filterKeys(keys, { query, status, now: NOW, owner }).map((k) => k.id)
    expect(f('prod')).toEqual(['a'])
    expect(f('ZZ9')).toEqual(['b'])
    expect(f('ci-bot')).toEqual(['c'])
    expect(f('', 'expired')).toEqual(['b'])
    expect(f('', 'active')).toEqual(['a', 'c'])
  })

  it('sorts, with Never expiring last and date columns starting newest-first', () => {
    const keys = [
      key({ id: 'a', name: 'b', expires_at: null }),
      key({ id: 'b', name: 'a', expires_at: new Date(NOW + DAY).toISOString() }),
    ]
    expect(sortKeys(keys, { column: 'name', direction: 'asc' }, owner, NOW).map((k) => k.id)).toEqual(['b', 'a'])
    expect(sortKeys(keys, { column: 'expires_at', direction: 'asc' }, owner, NOW).map((k) => k.id)).toEqual(['b', 'a'])
    expect(nextSort(null, 'created_at')).toEqual({ column: 'created_at', direction: 'desc' })
    expect(nextSort({ column: 'name', direction: 'asc' }, 'name')).toEqual({ column: 'name', direction: 'desc' })
  })

  it('gates row actions like the API', () => {
    expect(keyActions(key({}), { meId: 'me', canManageAnyKey: false })).toEqual({ canEdit: true, canRotate: true, canRevoke: true })
    expect(keyActions(key({ user_id: 'x' }), { meId: 'me', canManageAnyKey: false })).toEqual({
      canEdit: false,
      canRotate: false,
      canRevoke: false,
    })
    expect(keyActions(key({ key_type: 'session_key' }), { meId: 'me', canManageAnyKey: true })).toEqual({
      canEdit: true,
      canRotate: false,
      canRevoke: true,
    })
  })
})

describe('validateLimits', () => {
  it('accepts blanks and whole numbers, rejects the rest', () => {
    expect(validateLimits({ dailyTokenLimit: '', monthlyTokenLimit: '0', requestsPerMinute: ' 60 ', requestsPerDay: '' })).toEqual({})
    const errors = validateLimits({ dailyTokenLimit: '-1', monthlyTokenLimit: '1.5', requestsPerMinute: 'abc', requestsPerDay: '10' })
    expect(Object.keys(errors).sort()).toEqual(['dailyTokenLimit', 'monthlyTokenLimit', 'requestsPerMinute'])
  })
})
