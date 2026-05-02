import http from 'node:http'
import { randomUUID } from 'node:crypto'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import {
  OASIS_MCP_INSTRUCTIONS,
  OASIS_MCP_TOOL_SPECS,
  prepareOasisToolArgs,
} from '../src/lib/mcp/oasis-tool-spec.js'
import {
  PUBLIC_TOOL_NAMES,
  requiredScopeForPublicTool,
} from '../src/lib/relay/public-spellbook.js'

const SCREENSHOT_TOOL_NAMES = new Set([
  'screenshot_viewport',
  'screenshot_avatar',
  'avatarpic_user',
])

const PUBLIC_TOOL_NAME_SET = new Set(PUBLIC_TOOL_NAMES)

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || ''
  return typeof value === 'string' ? value : ''
}

function hasInitializeRequest(body) {
  if (!body) return false
  if (Array.isArray(body)) return body.some(isInitializeRequest)
  return isInitializeRequest(body)
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return null
  return JSON.parse(text)
}

function writeJsonRpcError(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  }))
}

function mimeTypeForFormat(format) {
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function extractImageContentBlocks(toolName, data) {
  if (!SCREENSHOT_TOOL_NAMES.has(toolName) || !data || typeof data !== 'object') {
    return { imageBlocks: [], strippedData: data }
  }
  const captures = Array.isArray(data.captures) ? data.captures : []
  if (captures.length === 0) return { imageBlocks: [], strippedData: data }

  const imageBlocks = []
  const strippedCaptures = captures.map((capture) => {
    if (!capture || typeof capture !== 'object') return capture
    const base64 = typeof capture.base64 === 'string' ? capture.base64 : ''
    if (base64) {
      imageBlocks.push({
        type: 'image',
        data: base64,
        mimeType: mimeTypeForFormat(capture.format),
      })
    }
    const { base64: _base64, ...rest } = capture
    return rest
  })

  const { base64: _topLevelBase64, ...restData } = data
  return {
    imageBlocks,
    strippedData: {
      ...restData,
      captures: strippedCaptures,
    },
  }
}

export function formatMcpToolResult(result, toolName) {
  const ok = Boolean(result?.ok)
  const { imageBlocks, strippedData } = extractImageContentBlocks(toolName, result?.data)
  const payload = ok
    ? { ok: true, data: strippedData }
    : {
        ok: false,
        error: result?.error || {
          code: 'tool_failed',
          message: typeof result?.message === 'string' ? result.message : 'Oasis tool call failed',
        },
        data: strippedData,
      }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
      ...imageBlocks,
    ],
    structuredContent: payload,
    isError: !ok,
  }
}

export function createBridgeMcpServer({
  relayToolCall,
  worldId,
  agentType = 'openclaw',
  logger = () => {},
  onToolCall = () => {},
  onToolResult = () => {},
}) {
  const server = new McpServer(
    { name: 'openclaw-oasis-relay-mcp', version: '0.3.0' },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions: [
        OASIS_MCP_INSTRUCTIONS,
        'This local adapter sends Oasis tools through the paired hosted relay.',
        'The browser tab is the executor; keep the tab open and paired while using tools.',
      ].join(' '),
    },
  )

  for (const spec of OASIS_MCP_TOOL_SPECS) {
    if (!PUBLIC_TOOL_NAME_SET.has(spec.name)) continue
    server.registerTool(
      spec.name,
      {
        title: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      },
      async (args = {}) => {
        const scope = requiredScopeForPublicTool(spec.name)
        if (!scope) {
          return formatMcpToolResult({
            ok: false,
            error: {
              code: 'tool_not_public',
              message: `Tool "${spec.name}" is not in the public Oasis spellbook.`,
            },
          }, spec.name)
        }

        const preparedArgs = prepareOasisToolArgs(spec.name, args || {}, { worldId, agentType })
        logger('MCP tool.call -> relay adapter', {
          toolName: spec.name,
          scope,
          worldId: preparedArgs?.worldId || worldId || '(none)',
        })
        onToolCall({
          toolName: spec.name,
          scope,
          worldId: preparedArgs?.worldId || worldId || '',
        })
        const result = await relayToolCall({
          toolName: spec.name,
          args: preparedArgs,
          scope,
        })
        onToolResult({
          toolName: spec.name,
          ok: Boolean(result?.ok),
          worldId: preparedArgs?.worldId || worldId || '',
        })
        return formatMcpToolResult(result, spec.name)
      },
    )
  }

  return server
}

export async function startBridgeMcpServer({
  host = '127.0.0.1',
  port = 17890,
  path = '/mcp',
  relayToolCall,
  worldId,
  agentType = 'openclaw',
  logger = () => {},
  onRequest = () => {},
  onToolCall = () => {},
  onToolResult = () => {},
}) {
  const sessions = new Map()

  function createSessionEntry() {
    let entry
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, entry)
      },
    })
    const server = createBridgeMcpServer({
      relayToolCall,
      worldId,
      agentType,
      logger,
      onToolCall,
      onToolResult,
    })
    entry = { server, transport }
    transport.onclose = () => {
      const sessionId = transport.sessionId
      if (sessionId) sessions.delete(sessionId)
    }
    return entry
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${headerValue(req.headers.host) || `${host}:${port}`}`)
      if (requestUrl.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (requestUrl.pathname !== path) {
        writeJsonRpcError(res, 404, -32004, 'Not found')
        return
      }

      let parsedBody
      if (req.method === 'POST') {
        try {
          parsedBody = await readJsonBody(req)
        } catch {
          writeJsonRpcError(res, 400, -32700, 'Parse error: Invalid JSON')
          return
        }
      }

      const sessionId = headerValue(req.headers['mcp-session-id'])
      let entry = sessionId ? sessions.get(sessionId) : null
      const initialize = hasInitializeRequest(parsedBody)
      logger('MCP adapter request', {
        method: req.method,
        path: requestUrl.pathname,
        sessionId: sessionId || '(new)',
        initialize,
      })
      onRequest({
        method: req.method || '',
        path: requestUrl.pathname,
        sessionId,
        initialize,
      })

      if (!entry) {
        if (sessionId) {
          writeJsonRpcError(res, 404, -32001, `Unknown MCP session: ${sessionId}`)
          return
        }
        if (req.method !== 'POST' || !initialize) {
          writeJsonRpcError(res, 400, -32000, 'Initialize this MCP session with a POST request first.')
          return
        }
        entry = createSessionEntry()
        await entry.server.connect(entry.transport)
      }

      await entry.transport.handleRequest(req, res, parsedBody)

      if (req.method === 'DELETE') {
        const closedSessionId = entry.transport.sessionId
        if (closedSessionId) sessions.delete(closedSessionId)
        await Promise.allSettled([entry.transport.close(), entry.server.close()])
      }
    } catch (error) {
      logger('MCP request failed:', error?.message || String(error))
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, 'Internal server error')
      } else {
        try { res.end() } catch {}
      }
    }
  })

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const address = httpServer.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}${path}`
  logger('OpenClaw Oasis MCP adapter listening', { url, worldId })

  return {
    url,
    port: actualPort,
    close: async () => {
      for (const [sessionId, entry] of sessions.entries()) {
        sessions.delete(sessionId)
        await Promise.allSettled([entry.transport.close(), entry.server.close()])
      }
      await new Promise((resolve) => httpServer.close(() => resolve()))
    },
  }
}
