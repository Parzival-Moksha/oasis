import { describe, expect, it } from 'vitest'
import { checkAgentRequest, splitHostHeader } from './local-request-guard'

function req(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } }
}

const LOCAL_ENV = { OASIS_MODE: 'local' }

describe('checkAgentRequest', () => {
  it('lets the local Oasis page through', () => {
    expect(checkAgentRequest(req({ host: 'localhost:4516', origin: 'http://localhost:4516', 'sec-fetch-site': 'same-origin' }), LOCAL_ENV)).toBeNull()
    expect(checkAgentRequest(req({ host: '127.0.0.1:4516', origin: 'http://127.0.0.1:4516' }), LOCAL_ENV)).toBeNull()
  })

  it('lets local CLI and MCP clients through (no Origin header)', () => {
    expect(checkAgentRequest(req({ host: '127.0.0.1:4516' }), LOCAL_ENV)).toBeNull()
  })

  it('treats localhost and 127.0.0.1 on the same port as one origin', () => {
    expect(checkAgentRequest(req({ host: '127.0.0.1:4516', origin: 'http://localhost:4516' }), LOCAL_ENV)).toBeNull()
  })

  it('blocks other websites in the same browser (CSRF)', () => {
    expect(checkAgentRequest(req({ host: 'localhost:4516', origin: 'https://evil.example' }), LOCAL_ENV)?.status).toBe(403)
    expect(checkAgentRequest(req({ host: 'localhost:4516', 'sec-fetch-site': 'cross-site' }), LOCAL_ENV)?.status).toBe(403)
    expect(checkAgentRequest(req({ host: 'localhost:4516', origin: 'null' }), LOCAL_ENV)?.status).toBe(403)
  })

  it('blocks a local page on a different port', () => {
    expect(checkAgentRequest(req({ host: 'localhost:4516', origin: 'http://localhost:3000' }), LOCAL_ENV)?.status).toBe(403)
  })

  it('blocks other devices and DNS rebinding names', () => {
    expect(checkAgentRequest(req({ host: '192.168.1.20:4516' }), LOCAL_ENV)?.status).toBe(403)
    expect(checkAgentRequest(req({ host: 'rebind.attacker.test:4516' }), LOCAL_ENV)?.status).toBe(403)
    expect(checkAgentRequest(req({ host: 'localhost:4516', 'x-forwarded-for': '203.0.113.9' }), LOCAL_ENV)?.status).toBe(403)
    expect(checkAgentRequest(req({ host: 'localhost:4516', 'x-forwarded-host': '04515.xyz' }), LOCAL_ENV)?.status).toBe(403)
  })

  it('hides agent routes on hosted deploys unless explicitly allowed', () => {
    expect(checkAgentRequest(req({ host: 'localhost:4516' }), { OASIS_MODE: 'hosted' })?.status).toBe(404)
    expect(checkAgentRequest(req({ host: 'localhost:4516' }), { OASIS_PROFILE: 'hosted-openclaw' })?.status).toBe(404)
    expect(checkAgentRequest(req({ host: 'localhost:4516' }), { OASIS_MODE: 'hosted', OASIS_ALLOW_HOSTED_AGENT_ROUTES: 'true' })).toBeNull()
  })

  it('turns agent routes off while shared on the LAN', () => {
    expect(checkAgentRequest(req({ host: 'localhost:4516' }), { OASIS_LAN: '1' })?.status).toBe(403)
  })
})

describe('splitHostHeader', () => {
  it('handles ports, bare hosts and IPv6', () => {
    expect(splitHostHeader('localhost:4516')).toEqual({ hostName: 'localhost', hostPort: '4516' })
    expect(splitHostHeader('localhost')).toEqual({ hostName: 'localhost', hostPort: '' })
    expect(splitHostHeader('[::1]:4516')).toEqual({ hostName: '[::1]', hostPort: '4516' })
  })
})
