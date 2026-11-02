// ░▒▓ LOCAL REQUEST GUARD ▓▒░
// Agent routes spawn real processes on this machine (claude, codex, pnpm) with
// permissions skipped. They answer only this machine's own Oasis page: never a
// hosted deploy, another device on the network, or another website open in the
// same browser (CSRF), and never a DNS-rebinding name that resolves to 127.0.0.1.
//
// Unlike the older Hermes check, this does not relax in development: `pnpm dev`
// is exactly where these routes run.

import { isHostedOasis } from './oasis-profile'

type EnvLike = { [key: string]: string | undefined }
type RequestLike = { headers: { get(name: string): string | null } }

export interface AgentRouteDenial {
  status: number
  error: string
}

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

export function splitHostHeader(host: string): { hostName: string; hostPort: string } {
  const trimmed = host.trim()
  if (!trimmed) return { hostName: '', hostPort: '' }
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end >= 0) return { hostName: trimmed.slice(0, end + 1), hostPort: trimmed.slice(end + 2) }
  }
  const colon = trimmed.lastIndexOf(':')
  if (colon > -1 && trimmed.indexOf(':') === colon) {
    return { hostName: trimmed.slice(0, colon), hostPort: trimmed.slice(colon + 1) }
  }
  return { hostName: trimmed, hostPort: '' }
}

const LOCAL_ONLY = 'Agent routes only answer the Oasis on this machine (http://localhost:4516).'

export function checkAgentRequest(request: RequestLike, env: EnvLike = process.env): AgentRouteDenial | null {
  if (isHostedOasis(env) && env.OASIS_ALLOW_HOSTED_AGENT_ROUTES !== 'true') {
    return { status: 404, error: 'Not found' }
  }
  if (env.OASIS_LAN === '1') {
    return { status: 403, error: 'Agent routes are off while the Oasis is shared on your network (pnpm dev:lan). Use pnpm dev.' }
  }

  const headers = request.headers
  const host = headers.get('host') || ''
  const { hostName, hostPort } = splitHostHeader(host)
  if (!isLoopbackHostname(hostName)) return { status: 403, error: LOCAL_ONLY }

  const forwardedHost = (headers.get('x-forwarded-host') || '').split(',')[0]?.trim() || ''
  if (forwardedHost && !isLoopbackHostname(splitHostHeader(forwardedHost).hostName)) {
    return { status: 403, error: LOCAL_ONLY }
  }
  const forwardedFor = (headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || ''
  if (forwardedFor && !isLoopbackHostname(forwardedFor)) return { status: 403, error: LOCAL_ONLY }

  if ((headers.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
    return { status: 403, error: 'Cross-site request blocked.' }
  }

  // Browsers always send Origin on cross-origin POSTs; CLI and MCP clients send none.
  const origin = headers.get('origin')
  if (origin) {
    if (origin === 'null') return { status: 403, error: 'Cross-site request blocked.' }
    try {
      const url = new URL(origin)
      const defaultPort = url.protocol === 'https:' ? '443' : '80'
      if (!isLoopbackHostname(url.hostname) || (url.port || defaultPort) !== (hostPort || defaultPort)) {
        return { status: 403, error: 'Cross-site request blocked.' }
      }
    } catch {
      return { status: 403, error: 'Cross-site request blocked.' }
    }
  }
  return null
}

/** Returns a ready error Response when the request may not drive local agents, else null. */
export function guardAgentRoute(request: RequestLike): Response | null {
  const denial = checkAgentRequest(request)
  return denial ? Response.json({ error: denial.error }, { status: denial.status }) : null
}
