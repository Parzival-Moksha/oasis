import 'server-only'

import { randomUUID } from 'crypto'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { callTool } from '@/lib/mcp/oasis-tools'
import {
  OASIS_MCP_INSTRUCTIONS,
  OASIS_MCP_TOOL_SPECS,
  prepareOasisToolArgs,
} from '@/lib/mcp/oasis-tool-spec.js'

function formatToolResult(result: Awaited<ReturnType<typeof callTool>>) {
  const structuredContent: Record<string, unknown> = {
    ok: result.ok,
    message: result.message,
  }
  if (result.data !== undefined) {
    structuredContent.data = result.data as unknown
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent,
    isError: !result.ok,
  }
}

export function createOasisMcpServer(context?: { worldId?: string; agentType?: string }) {
  const server = new McpServer(
    { name: 'oasis-http-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions: OASIS_MCP_INSTRUCTIONS,
    },
  )

  for (const spec of OASIS_MCP_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      {
        title: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      },
      async (args: Record<string, unknown> = {}) => formatToolResult(await callTool(
        spec.name,
        prepareOasisToolArgs(spec.name, args, context),
      )),
    )
  }

  return server
}

export type OasisHttpMcpSession = {
  server: McpServer
  transport: WebStandardStreamableHTTPServerTransport
  createdAt: number
  lastSeenAt: number
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000

function getSessionStore() {
  const globalState = globalThis as typeof globalThis & {
    __oasisHttpMcpSessions?: Map<string, OasisHttpMcpSession>
  }
  if (!globalState.__oasisHttpMcpSessions) {
    globalState.__oasisHttpMcpSessions = new Map()
  }
  return globalState.__oasisHttpMcpSessions
}

export function getOasisHttpMcpSession(sessionId: string | null | undefined) {
  if (!sessionId) return null
  return getSessionStore().get(sessionId) || null
}

export function pruneOasisHttpMcpSessions() {
  const sessions = getSessionStore()
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [sessionId, entry] of sessions.entries()) {
    if (entry.lastSeenAt >= cutoff) continue
    void entry.transport.close().catch(() => {})
    void entry.server.close().catch(() => {})
    sessions.delete(sessionId)
  }
}

export async function createOasisHttpMcpSession(context?: { worldId?: string; agentType?: string }) {
  const server = createOasisMcpServer(context)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return { server, transport }
}

export function rememberOasisHttpMcpSession(sessionId: string, session: OasisHttpMcpSession) {
  getSessionStore().set(sessionId, session)
}

export async function disposeOasisHttpMcpSession(sessionId: string | null | undefined) {
  if (!sessionId) return
  const sessions = getSessionStore()
  const entry = sessions.get(sessionId)
  if (!entry) return
  sessions.delete(sessionId)
  await Promise.allSettled([
    entry.transport.close(),
    entry.server.close(),
  ])
}
