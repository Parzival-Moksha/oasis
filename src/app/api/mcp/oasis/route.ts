import { NextRequest } from 'next/server'

import {
  createOasisHttpMcpSession,
  disposeOasisHttpMcpSession,
  getOasisHttpMcpSession,
  pruneOasisHttpMcpSessions,
  rememberOasisHttpMcpSession,
} from '@/lib/mcp/oasis-mcp-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

async function handleMcpRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return jsonError('Unauthorized', 401)
  }

  pruneOasisHttpMcpSessions()

  const sessionId = request.headers.get('mcp-session-id')
  let entry = getOasisHttpMcpSession(sessionId)

  if (!entry) {
    if (sessionId) {
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
