import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  hostedVisitorOpenclawStatusResponse,
  shouldBlockHostedVisitorOpenclawGateway,
} from '../openclaw-hosted-boundary'

describe('openclaw hosted boundary', () => {
  const originalMode = process.env.OASIS_MODE
  const originalProfile = process.env.OASIS_PROFILE
  const originalAdminToken = process.env.OASIS_ADMIN_TOKEN

  beforeEach(() => {
    process.env.OASIS_MODE = 'hosted'
    process.env.OASIS_PROFILE = 'hosted-openclaw'
    delete process.env.OASIS_ADMIN_TOKEN
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalProfile === undefined) delete process.env.OASIS_PROFILE
    else process.env.OASIS_PROFILE = originalProfile
    if (originalAdminToken === undefined) delete process.env.OASIS_ADMIN_TOKEN
    else process.env.OASIS_ADMIN_TOKEN = originalAdminToken
  })

  it('blocks hosted visitors from the server loopback OpenClaw gateway', () => {
    const request = new Request('https://openclaw.04515.xyz/api/openclaw/status')
    expect(shouldBlockHostedVisitorOpenclawGateway(request)).toBe(true)
  })

  it('returns a relay-only status facade instead of VPS gateway state', async () => {
    const response = hostedVisitorOpenclawStatusResponse()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.gatewayClient.state).toBe('closed')
    expect(payload.gateway.reachable).toBe(false)
    expect(payload.gateway.label).toContain('relay')
    expect(payload.transport).toBeUndefined()
  })
})
