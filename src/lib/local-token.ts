// The local key, in the browser. When the Oasis runs with a key (scripts/oasis.mjs starts it that way in the
// slim edition), the page is opened with ?key=…; the page server turns that into the `oasis_token` cookie
// (src/middleware.ts), which rides along on every request to the page server. The agent engine listens on
// another address, where the cookie does not go, so links to it carry the key as ?token=.
export const LOCAL_TOKEN_COOKIE = 'oasis_token'

/** The key from the cookie; '' when the Oasis runs without one. */
export function localToken(cookie: string | undefined = typeof document === 'undefined' ? '' : document.cookie): string {
  for (const part of (cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === LOCAL_TOKEN_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return ''
}

/** The same address with the key added, when there is one. */
export function withLocalToken(url: string, token: string = localToken()): string {
  if (!token) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('token', token)
    return parsed.toString()
  } catch {
    return url
  }
}

/** Constant-time comparison for two short strings. */
export function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return LOOPBACK_HOSTS.has(name.toLowerCase())
}

export interface LocalGateRequest {
  host: string | null
  origin: string | null
  secFetchSite: string | null
  pathname: string
  /** ?key= on the address */
  key: string | null
  cookieToken: string | null
  headerToken: string | null
}

export type LocalGateVerdict =
  | { action: 'pass' }
  | { action: 'set-cookie' }
  | { action: 'deny'; status: number; error: string }

/**
 * What the page server does with a request when it runs with a local key.
 * Pages and static files load without it (the page has to load before it can be given the key); everything
 * under /api needs it, from a loopback address, and not from another site.
 */
export function localGate(req: LocalGateRequest, required: string): LocalGateVerdict {
  if (!required) return { action: 'pass' }
  if (!isLoopbackHost(req.host)) return { action: 'deny', status: 403, error: 'The Oasis answers on this machine only.' }
  const isApi = req.pathname.startsWith('/api/')
  if (!isApi) return req.key && sameToken(req.key, required) ? { action: 'set-cookie' } : { action: 'pass' }
  if (req.secFetchSite === 'cross-site') return { action: 'deny', status: 403, error: 'Requests from other sites are refused.' }
  if (req.origin) {
    try {
      if (!isLoopbackHost(new URL(req.origin).host) || new URL(req.origin).host !== req.host) return { action: 'deny', status: 403, error: 'Requests from other origins are refused.' }
    } catch {
      return { action: 'deny', status: 403, error: 'Requests from other origins are refused.' }
    }
  }
  const given = req.headerToken || req.cookieToken || ''
  if (!sameToken(given, required)) return { action: 'deny', status: 401, error: 'This Oasis asks for its local key. Open it with /oasis in Claude Code, or with `node scripts/oasis.mjs start`.' }
  return { action: 'pass' }
}
