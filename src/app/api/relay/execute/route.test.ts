import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { signSessionCookie } from '@/lib/relay/auth'
import { SESSION_COOKIE_NAME } from '@/lib/session'
import { callTool } from '@/lib/mcp/oasis-tools'

import { POST } from './route'

vi.mock('@/lib/mcp/oasis-tools', () => ({
  callTool: vi.fn(),
}))

const ORIGINAL_ENV = {
  OASIS_PROFILE: process.env.OASIS_PROFILE,
  OASIS_MODE: process.env.OASIS_MODE,
  RELAY_SIGNING_KEY: process.env.RELAY_SIGNING_KEY,
}

function makeHostedRequest(body: Record<string, unknown>): NextRequest {
  const cookie = signSessionCookie('bs-test-route')
  return new Request('http://localhost/api/relay/execute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('/api/relay/execute hosted world targeting', () => {
  beforeEach(() => {
    process.env.OASIS_PROFILE = 'hosted-openclaw'
    process.env.OASIS_MODE = 'hosted'
    process.env.RELAY_SIGNING_KEY = 'test-signing-key-for-route'
    vi.mocked(callTool).mockReset()
  })

  afterEach(() => {
    process.env.OASIS_PROFILE = ORIGINAL_ENV.OASIS_PROFILE
    process.env.OASIS_MODE = ORIGINAL_ENV.OASIS_MODE
    process.env.RELAY_SIGNING_KEY = ORIGINAL_ENV.RELAY_SIGNING_KEY
  })

  it.each([undefined, '', '   ', '__active__'])(
    'rejects missing or placeholder hosted worldId %s before invoking a tool',
    async (worldId) => {
      const response = await POST(makeHostedRequest({
        toolName: 'get_world_info',
        args: {},
        worldId,
        agentType: 'openclaw',
      }))

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toMatchObject({
        ok: false,
        error: { code: 'tool_world_context_required' },
      })
      expect(callTool).not.toHaveBeenCalled()
    },
  )
})
