import { PROXY_PUBLIC_BASE } from './constants'

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.startsWith('127.')
}

/**
 * Public OpenAI-compatible base URL (ends in `/v1`). Uses PROXY_PUBLIC_BASE, except when that
 * points at localhost while the dashboard itself is served from a real host (e.g.
 * https://ai.waiin.com): then the proxy is assumed to share the dashboard origin (`<origin>/v1`).
 */
export function resolveProxyBaseUrl(
  configured: string = PROXY_PUBLIC_BASE,
  location: Pick<Location, 'origin' | 'hostname'> | undefined = typeof window !== 'undefined' ? window.location : undefined,
): string {
  if (!location) return configured
  try {
    const url = new URL(configured)
    if (isLoopbackHost(url.hostname) && !isLoopbackHost(location.hostname)) {
      return `${location.origin.replace(/\/$/, '')}/v1`
    }
  } catch {
    // Relative or malformed config: fall through.
  }
  return configured
}
