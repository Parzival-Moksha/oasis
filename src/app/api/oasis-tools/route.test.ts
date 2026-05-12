import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { signSessionCookie } from '@/lib/relay/auth'
import { SESSION_COOKIE_NAME } from '@/lib/session'
import { callTool } from '@/lib/mcp/oasis-tools'

import { GET, POST } from './route'

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

function makeHostedBrowserPost(body: unknown, url = 'http://localhost/api/oasis-tools?worldId=world-test'): NextRequest {
  const cookie = signSessionCookie('bs-oasis-tools-test')
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    },
    body: JSON.stringify(body),
  })
}

describe('/api/oasis-tools hosted browser auth', () => {
  beforeEach(() => {
    process.env.OASIS_PROFILE = 'hosted-openclaw'
    process.env.OASIS_MODE = 'hosted'
    process.env.OASIS_MCP_KEY = 'unit-test-mcp-key'
    process.env.RELAY_SIGNING_KEY = 'unit-test-relay-signing-key'
    vi.mocked(callTool).mockReset()
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

  it('merges the browser worldId query into hosted tool args before execution', async () => {
    vi.mocked(callTool).mockResolvedValue({
      ok: true,
      message: 'ok',
      data: { worldId: 'world-test' },
    })

    const response = await POST(makeHostedBrowserPost({
      tool: 'get_world_info',
      args: {},
    }))

    expect(response.status).toBe(200)
    expect(callTool).toHaveBeenCalledWith(
      'get_world_info',
      { worldId: 'world-test' },
      expect.objectContaining({
        requireExplicitWorld: true,
        userId: 'bs-oasis-tools-test',
      }),
    )
  })

  it('returns JSON when a hosted tool call throws before producing a result', async () => {
    vi.mocked(callTool).mockRejectedValue(new Error('boom'))

    const response = await POST(makeHostedBrowserPost({
      tool: 'get_world_info',
      args: {},
    }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      data: {
        code: 'oasis_tool_route_crashed',
      },
    })
  })

  it('returns JSON when a hosted tool call never resolves', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(callTool).mockReturnValue(new Promise(() => {}) as ReturnType<typeof callTool>)

      const pending = POST(makeHostedBrowserPost({
        tool: 'get_world_info',
        args: {},
      }))

      await vi.advanceTimersByTimeAsync(45_000)
      const response = await pending

      expect(response.status).toBe(504)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        data: {
          code: 'oasis_tool_route_timeout',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
