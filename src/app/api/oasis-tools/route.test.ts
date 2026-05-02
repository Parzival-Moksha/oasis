import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { signSessionCookie } from '@/lib/relay/auth'
import { SESSION_COOKIE_NAME } from '@/lib/session'

import { GET } from './route'

vi.mock('@/lib/mcp/oasis-tools', () => ({
  TOOL_NAMES: ['get_world_info', 'screenshot_viewport'],
  callTool: vi.fn(),
  deliverScreenshot: vi.fn(),
  getPendingScreenshotRequest: vi.fn(() => null),
  isScreenshotPending: vi.fn(() => false),
}))
vi.mock('@/lib/hermes-remote', () => ({
  buildHermesRemoteExec: vi.fn(() => null),
}))

const ORIGINAL_ENV = {
  OASIS_PROFILE: process.env.OASIS_PROFILE,
  OASIS_MODE: process.env.OASIS_MODE,
  OASIS_MCP_KEY: process.env.OASIS_MCP_KEY,
  RELAY_SIGNING_KEY: process.env.RELAY_SIGNING_KEY,
}

function makeHostedBrowserRequest(): NextRequest {
  const cookie = signSessionCookie('bs-oasis-tools-test')
  return new NextRequest('http://localhost/api/oasis-tools?worldId=world-test', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    },
  })
}

describe('/api/oasis-tools hosted browser auth', () => {
  beforeEach(() => {
    process.env.OASIS_PROFILE = 'hosted-openclaw'
    process.env.OASIS_MODE = 'hosted'
    process.env.OASIS_MCP_KEY = 'unit-test-mcp-key'
    process.env.RELAY_SIGNING_KEY = 'unit-test-relay-signing-key'
  })

  afterEach(() => {
    process.env.OASIS_PROFILE = ORIGINAL_ENV.OASIS_PROFILE
    process.env.OASIS_MODE = ORIGINAL_ENV.OASIS_MODE
    process.env.OASIS_MCP_KEY = ORIGINAL_ENV.OASIS_MCP_KEY
    process.env.RELAY_SIGNING_KEY = ORIGINAL_ENV.RELAY_SIGNING_KEY
  })

  it('allows the hosted browser screenshot bridge to poll with its session cookie', async () => {
    const response = await GET(makeHostedBrowserRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      tools: ['get_world_info', 'screenshot_viewport'],
      screenshotPending: false,
    })
  })
})
