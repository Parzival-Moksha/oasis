import { afterEach, describe, expect, it } from 'vitest'

import {
  formatMcpToolResult,
  startBridgeMcpServer,
} from '../openclaw-bridge-mcp.mjs'

const started = []
const PROTOCOL_VERSION = '2025-06-18'

afterEach(async () => {
  while (started.length > 0) {
    const server = started.pop()
    await server.close()
  }
})

async function postMcp(url, body, sessionId = '') {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': PROTOCOL_VERSION,
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') || '',
    json: text ? JSON.parse(text) : null,
  }
}

async function initialize(url) {
  const init = await postMcp(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'bridge-mcp-test', version: '0.0.0' },
    },
  })
  expect(init.status).toBe(200)
  expect(init.sessionId).toBeTruthy()
  return init.sessionId
}

describe('openclaw bridge MCP adapter', () => {
  it('lists only public Oasis tools and proxies calls through relay tool.call shape', async () => {
    const calls = []
    const toolHits = []
    const requestHits = []
    const server = await startBridgeMcpServer({
      port: 0,
      worldId: 'world-test',
      onRequest: (hit) => requestHits.push(hit),
      onToolCall: (hit) => toolHits.push(hit),
      relayToolCall: async (call) => {
        calls.push(call)
        return { ok: true, data: { echoedTool: call.toolName, echoedArgs: call.args } }
      },
    })
    started.push(server)

    const sessionId = await initialize(server.url)

    const listed = await postMcp(server.url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, sessionId)
    expect(listed.status).toBe(200)
    const toolNames = listed.json.result.tools.map(tool => tool.name)
    expect(toolNames).toContain('get_world_info')
    expect(toolNames).toContain('place_object')
    expect(toolNames).not.toContain('clear_world')

    const called = await postMcp(server.url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_world_info',
        arguments: {},
      },
    }, sessionId)
    expect(called.status).toBe(200)
    expect(called.json.result.isError).toBe(false)
    expect(calls).toEqual([{
      toolName: 'get_world_info',
      args: { worldId: 'world-test' },
      scope: 'world.read',
    }])
    expect(requestHits.some(hit => hit.initialize)).toBe(true)
    expect(toolHits).toEqual([{
      toolName: 'get_world_info',
      scope: 'world.read',
      worldId: 'world-test',
    }])
  })

  it('returns browser screenshot pixels as MCP image blocks without duplicating base64 in text', () => {
    const formatted = formatMcpToolResult({
      ok: true,
      data: {
        captures: [
          { viewId: 'current', base64: 'abc123', format: 'png', filePath: 'capture.png' },
        ],
      },
    }, 'screenshot_viewport')

    expect(formatted.isError).toBe(false)
    expect(formatted.content[1]).toEqual({
      type: 'image',
      data: 'abc123',
      mimeType: 'image/png',
    })
    expect(formatted.content[0].text).toContain('capture.png')
    expect(formatted.content[0].text).not.toContain('abc123')
  })

  it('uses the latest browser-announced world id for future tool calls', async () => {
    let currentWorldId = 'world-a'
    const calls = []
    const server = await startBridgeMcpServer({
      port: 0,
      worldId: 'world-paired',
      getWorldId: () => currentWorldId,
      relayToolCall: async (call) => {
        calls.push(call)
        return { ok: true, data: { echoedArgs: call.args } }
      },
    })
    started.push(server)

    const sessionId = await initialize(server.url)

    await postMcp(server.url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_world_info', arguments: {} },
    }, sessionId)
    currentWorldId = 'world-b'
    await postMcp(server.url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_world_info', arguments: {} },
    }, sessionId)

    expect(calls.map(call => call.args.worldId)).toEqual(['world-a', 'world-b'])
  })
})
