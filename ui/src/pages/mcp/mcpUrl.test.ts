import { describe, it, expect } from 'vitest'
import { buildClientConfig, getMCPBaseUrl, mcpServerEndpoint } from './mcpUrl'
import { canWriteServer, filterServers, nextSort } from './helpers'

describe('getMCPBaseUrl', () => {
  it('uses the page origin when the proxy base is localhost but the app is not', () => {
    expect(getMCPBaseUrl('http://localhost:8081/v1', 'https://ai.waiin.com')).toBe('https://ai.waiin.com')
    expect(getMCPBaseUrl('http://127.0.0.1:8081/v1', 'https://ai.waiin.com')).toBe('https://ai.waiin.com')
  })

  it('keeps the proxy origin when the app is also on localhost', () => {
    expect(getMCPBaseUrl('http://localhost:8081/v1', 'http://127.0.0.1:5173')).toBe('http://localhost:8081')
  })

  it('keeps a non-local proxy base as-is (origin only, no /v1)', () => {
    expect(getMCPBaseUrl('https://proxy.example.com/v1', 'https://ai.waiin.com')).toBe('https://proxy.example.com')
  })

  it('falls back to the page origin when the proxy base is invalid', () => {
    expect(getMCPBaseUrl('not a url', 'https://ai.waiin.com')).toBe('https://ai.waiin.com')
  })
})

describe('mcpServerEndpoint / buildClientConfig', () => {
  const base = 'https://ai.waiin.com'

  it('builds per-server and Code Mode endpoints', () => {
    expect(mcpServerEndpoint('fs', base)).toBe('https://ai.waiin.com/api/v1/mcp/fs')
    expect(mcpServerEndpoint(undefined, base)).toBe('https://ai.waiin.com/api/v1/mcp')
  })

  it('produces valid JSON for each client', () => {
    const url = mcpServerEndpoint('fs', base)
    const cursor = JSON.parse(buildClientConfig('cursor', 'fs', url))
    expect(cursor.mcpServers.fs.url).toBe(url)
    expect(cursor.mcpServers.fs.headers.Authorization).toMatch(/^Bearer /)

    const vscode = JSON.parse(buildClientConfig('vscode', 'fs', url))
    expect(vscode.servers.fs).toMatchObject({ type: 'http', url })

    const claude = JSON.parse(buildClientConfig('claude', 'fs', url))
    expect(claude.mcpServers.fs.command).toBe('npx')
    expect(claude.mcpServers.fs.args).toContain(url)
  })
})

describe('canWriteServer', () => {
  const sys = { isSystemAdmin: true, isOrgAdmin: true, isTeamAdmin: true }
  const org = { isSystemAdmin: false, isOrgAdmin: true, isTeamAdmin: true }
  const team = { isSystemAdmin: false, isOrgAdmin: false, isTeamAdmin: true }
  const member = { isSystemAdmin: false, isOrgAdmin: false, isTeamAdmin: false }

  it('global servers are writable only by system admins', () => {
    const s = { scope: 'global' }
    expect(canWriteServer(s, sys, 'o1')).toBe(true)
    expect(canWriteServer(s, org, 'o1')).toBe(false)
  })

  it('org servers are writable by admins of that org only', () => {
    expect(canWriteServer({ scope: 'org', org_id: 'o1' }, org, 'o1')).toBe(true)
    expect(canWriteServer({ scope: 'org', org_id: 'o2' }, org, 'o1')).toBe(false)
    expect(canWriteServer({ scope: 'org', org_id: 'o1' }, team, 'o1')).toBe(false)
  })

  it('team servers are writable by team admins', () => {
    expect(canWriteServer({ scope: 'team', org_id: 'o1', team_id: 't1' }, team, 'o1')).toBe(true)
    expect(canWriteServer({ scope: 'team', org_id: 'o1', team_id: 't1' }, member, 'o1')).toBe(false)
  })
})

describe('filterServers / nextSort', () => {
  const servers = [
    { name: 'GitHub', alias: 'gh', url: 'https://gh.example.com/mcp', source: 'api' },
    { name: 'Files', alias: 'fs', url: 'http://127.0.0.1:7331/mcp', source: 'api' },
  ]

  it('matches name, alias and url case-insensitively', () => {
    expect(filterServers(servers, 'github')).toHaveLength(1)
    expect(filterServers(servers, 'FS')).toHaveLength(1)
    expect(filterServers(servers, '7331')).toHaveLength(1)
    expect(filterServers(servers, '  ')).toHaveLength(2)
  })

  it('cycles asc → desc → off', () => {
    const a = nextSort(null, 'name')
    expect(a).toEqual({ column: 'name', direction: 'asc' })
    const b = nextSort(a, 'name')
    expect(b).toEqual({ column: 'name', direction: 'desc' })
    expect(nextSort(b, 'name')).toBeNull()
  })
})
