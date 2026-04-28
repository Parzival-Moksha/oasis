import { NextRequest } from 'next/server'

import {
  createOasisHttpMcpSession,
  createStatelessOasisHttpMcpSession,
  disposeOasisHttpMcpSession,
  getOasisHttpMcpSession,
  pruneOasisHttpMcpSessions,
  rememberOasisHttpMcpSession,
} from '@/lib/mcp/oasis-mcp-http'
import { getOasisMode } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// In hosted mode the public agent path is the WSS relay, not direct MCP HTTP.
// Refuse the route so a misconfigured agent can't bypass relay scope checks.
function hostedModeBlocked(): Response | null {
  if (getOasisMode() !== 'hosted') return null
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'mcp http transport disabled in hosted mode; pair via the WSS relay' },
    id: null,
  }), {
    status: 410,
    headers: { 'content-type': 'application/json' },
  })
}

function readSessionContext(request: NextRequest) {
  const worldId = (request.nextUrl.searchParams.get('worldId') || request.headers.get('x-oasis-world-id') || '').trim()
  const agentType = (request.nextUrl.searchParams.get('agentType') || request.headers.get('x-oasis-agent-type') || '').trim().toLowerCase()
  return {
    ...(worldId ? { worldId } : {}),
    ...(agentType ? { agentType } : {}),
  }
}

function isAuthorized(request: NextRequest): boolean {
  const key = process.env.OASIS_MCP_KEY
  if (!key) return true
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  return token === key
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  }), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

async function readJsonRpcBody(request: NextRequest): Promise<unknown | undefined> {
  try {
    return await request.clone().json() as unknown
  } catch {
    return undefined
  }
}

function containsInitializeRequest(value: unknown): boolean {
  const messages = Array.isArray(value) ? value : [value]
  return messages.some(message =>
    !!message
      && typeof message === 'object'
      && (message as Record<string, unknown>).method === 'initialize',
  )
}

async function handleMcpRequest(request: NextRequest) {
  const blocked = hostedModeBlocked()
  if (blocked) return blocked

  if (!isAuthorized(request)) {
    return jsonError('Unauthorized', 401)
  }

  pruneOasisHttpMcpSessions()

  const sessionId = request.headers.get('mcp-session-id')
  let entry = getOasisHttpMcpSession(sessionId)

  if (!entry) {
    if (sessionId) {
      if (request.method === 'POST') {
        const parsedBody = await readJsonRpcBody(request)
        if (containsInitializeRequest(parsedBody)) {
          const created = await createOasisHttpMcpSession(readSessionContext(request))
          entry = {
            ...created,
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
          }
          const response = await entry.transport.handleRequest(request, { parsedBody })
          const resolvedSessionId = entry.transport.sessionId
          if (resolvedSessionId) {
            rememberOasisHttpMcpSession(resolvedSessionId, entry)
          }
          return response
        }

        const rescue = await createStatelessOasisHttpMcpSession(readSessionContext(request))
        try {
          return await rescue.transport.handleRequest(request, { parsedBody })
        } finally {
          await Promise.allSettled([
            rescue.transport.close(),
            rescue.server.close(),
          ])
        }
      }
      return jsonError(`Unknown MCP session: ${sessionId}`, 404)
    }
    if (request.method !== 'POST') {
      return jsonError('Initialize with a POST request before using this MCP session.', 400)
    }
    const created = await createOasisHttpMcpSession(readSessionContext(request))
    entry = {
      ...created,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }
  } else {
    entry.lastSeenAt = Date.now()
  }

  const response = await entry.transport.handleRequest(request)
  const resolvedSessionId = entry.transport.sessionId
  if (resolvedSessionId) {
    rememberOasisHttpMcpSession(resolvedSessionId, entry)
  }

  if (request.method === 'DELETE') {
    await disposeOasisHttpMcpSession(sessionId || resolvedSessionId)
  }

  return response
}

export async function GET(request: NextRequest) {
  return handleMcpRequest(request)
}

export async function POST(request: NextRequest) {
  return handleMcpRequest(request)
}

export async function DELETE(request: NextRequest) {
  return handleMcpRequest(request)
}
