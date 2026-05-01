import 'server-only'

import { randomUUID } from 'crypto'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { callTool, type OasisToolContext } from '@/lib/mcp/oasis-tools'
import {
  OASIS_MCP_INSTRUCTIONS,
  OASIS_MCP_TOOL_SPECS,
  prepareOasisToolArgs,
} from '@/lib/mcp/oasis-tool-spec.js'

// Tools whose captures should surface as MCP image content blocks so external
// clients (OpenClaw, remote Claude Code, etc.) can SEE the pixels instead of
// bouncing off loopback URLs and Windows file paths they can't reach.
const SCREENSHOT_TOOL_NAMES = new Set([
  'screenshot_viewport',
  'screenshot_avatar',
  'avatarpic_merlin',
  'avatarpic_user',
])

function mimeTypeForFormat(format: unknown): string {
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return 'image/jpeg'
}

type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

interface ScreenshotCaptureShape {
  viewId?: unknown
  base64?: unknown
  format?: unknown
  url?: unknown
  filePath?: unknown
}

function isScreenshotCaptureShape(value: unknown): value is ScreenshotCaptureShape {
  return !!value && typeof value === 'object'
}

function extractImageContentBlocks(toolName: string, data: unknown): { imageBlocks: McpContentBlock[]; strippedData: unknown } {
  if (!SCREENSHOT_TOOL_NAMES.has(toolName) || !data || typeof data !== 'object') {
    return { imageBlocks: [], strippedData: data }
  }

  const sourceCaptures = (data as { captures?: unknown }).captures
  if (!Array.isArray(sourceCaptures)) {
    return { imageBlocks: [], strippedData: data }
  }

  const imageBlocks: McpContentBlock[] = []
  const strippedCaptures = sourceCaptures.map((capture) => {
    if (!isScreenshotCaptureShape(capture)) return capture
    const base64 = typeof capture.base64 === 'string' ? capture.base64 : ''
    if (base64) {
      imageBlocks.push({
        type: 'image',
        data: base64,
        mimeType: mimeTypeForFormat(capture.format),
      })
    }
    const { base64: _droppedBase64, ...rest } = capture as ScreenshotCaptureShape & { base64?: unknown }
    return rest
  })

  // Also strip the top-level `data.base64` blob — if we emitted it as a content
  // block, repeating it in the text JSON is just noise.
  const { base64: _dataBase64, ...restData } = data as { base64?: unknown; [key: string]: unknown }
  return {
    imageBlocks,
    strippedData: {
      ...restData,
      captures: strippedCaptures,
    },
  }
}

function formatToolResult(result: Awaited<ReturnType<typeof callTool>>, toolName: string) {
  const { imageBlocks, strippedData } = extractImageContentBlocks(toolName, result.data)

  const structuredContent: Record<string, unknown> = {
    ok: result.ok,
    message: result.message,
  }
  if (strippedData !== undefined) {
    structuredContent.data = strippedData
  }

  const content: McpContentBlock[] = [
    {
      type: 'text',
      text: JSON.stringify({ ok: result.ok, message: result.message, data: strippedData }, null, 2),
    },
    ...imageBlocks,
  ]

  return {
    content,
    structuredContent,
    isError: !result.ok,
  }
}

export function createOasisMcpServer(context?: Pick<OasisToolContext, 'worldId' | 'agentType' | 'userId'>) {
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
        {
          source: 'mcp',
          userId: context?.userId,
          worldId: context?.worldId,
          agentType: context?.agentType,
        },
      ), spec.name),
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

export async function createOasisHttpMcpSession(context?: Pick<OasisToolContext, 'worldId' | 'agentType' | 'userId'>) {
  const server = createOasisMcpServer(context)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return { server, transport }
}

export async function createStatelessOasisHttpMcpSession(context?: Pick<OasisToolContext, 'worldId' | 'agentType' | 'userId'>) {
  const server = createOasisMcpServer(context)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
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
