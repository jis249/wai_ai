import { PROXY_PUBLIC_BASE } from '../../lib/constants'
import { resolveProxyBaseUrl } from '../../lib/proxyUrl'


/**
 * Public origin that MCP clients should connect to (no trailing slash).
 *
 * Starts from `PROXY_PUBLIC_BASE` (same host that serves `/v1`). When that points at
 * localhost but the dashboard itself is being served from a real host (e.g.
 * https://ai.waiin.com), the dashboard origin is used instead so copied configs work
 * from other machines.
 */
export function getMCPBaseUrl(
  proxyBase: string = PROXY_PUBLIC_BASE,
  pageOrigin: string | undefined = typeof window !== 'undefined' ? window.location.origin : undefined,
): string {
  const page = pageOrigin ? new URL(pageOrigin) : undefined
  const resolved = resolveProxyBaseUrl(proxyBase, page ? { origin: page.origin, hostname: page.hostname } : undefined)
  try {
    return new URL(resolved).origin
  } catch {
    return page?.origin ?? ''
  }
}

/** Per-server endpoint, or the Code Mode endpoint (all tools) when `alias` is omitted. */
export function mcpServerEndpoint(alias?: string, base: string = getMCPBaseUrl()): string {
  return alias ? `${base}/api/v1/mcp/${encodeURIComponent(alias)}` : `${base}/api/v1/mcp`
}

export type MCPClient = 'claude' | 'cursor' | 'vscode'

export const MCP_CLIENTS: { value: MCPClient; label: string; file: string }[] = [
  { value: 'claude', label: 'Claude Desktop', file: 'claude_desktop_config.json' },
  { value: 'cursor', label: 'Cursor', file: '~/.cursor/mcp.json' },
  { value: 'vscode', label: 'VS Code', file: '.vscode/mcp.json' },
]

export const API_KEY_PLACEHOLDER = '<your-api-key>'

/** JSON config snippet for a given client. */
export function buildClientConfig(client: MCPClient, name: string, url: string): string {
  const auth = `Bearer ${API_KEY_PLACEHOLDER}`
  let config: unknown
  if (client === 'claude') {
    // Claude Desktop only launches stdio servers; bridge to HTTP with mcp-remote.
    config = {
      mcpServers: {
        [name]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: auth },
        },
      },
    }
  } else if (client === 'cursor') {
    config = { mcpServers: { [name]: { url, headers: { Authorization: auth } } } }
  } else {
    config = { servers: { [name]: { type: 'http', url, headers: { Authorization: auth } } } }
  }
  return JSON.stringify(config, null, 2)
}
