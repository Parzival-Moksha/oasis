import http from 'node:http'
import { spawn } from 'node:child_process'

import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

function closeHttp(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

function onceWithTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

describe('Hermes Oasis bridge Responses API mode', () => {
  it('uses Hermes /v1/responses conversation state instead of replaying chat history', async () => {
    let responsesRequest = null

    const hermesApi = http.createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/v1/health' || req.url === '/health')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'hermes-agent' }] }))
        return
      }
      if (req.method === 'POST' && req.url === '/v1/responses') {
        let body = ''
        for await (const chunk of req) body += chunk
        responsesRequest = JSON.parse(body)
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write('data: {"type":"response.created","response":{"id":"resp_test"}}\n\n')
        res.write('data: {"type":"response.output_text.delta","delta":"hello"}\n\n')
        res.write('data: {"type":"response.output_text.delta","delta":" world"}\n\n')
        res.write('data: {"type":"response.completed","response":{"id":"resp_test","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello world"}]}]}}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(404)
      res.end('not found')
    })

    const oasisApi = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/api/relay/devices/exchange') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          deviceToken: 'dev_test_token',
          browserSessionId: 'bs_test',
          worldId: 'world_test',
          scopes: ['chat.stream', 'world.read', 'world.write.safe', 'screenshot.request'],
          agentType: 'hermes',
          agentSlot: 'hermes:primary',
          agentLabel: 'hermes-bridge',
        }))
        return
      }
      res.writeHead(404)
      res.end('not found')
    })

    const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    const relayReady = new Promise(resolve => relay.once('listening', resolve))
    const finalMessage = new Promise(resolve => {
      relay.on('connection', ws => {
        let chatSent = false
        ws.send(JSON.stringify({
          type: 'relay.paired',
          role: 'agent',
          relaySessionId: 'rs_test',
          sentAt: Date.now(),
          messageId: 'relay-paired',
        }))
        ws.on('message', raw => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'agent.hello' && !chatSent) {
            chatSent = true
            ws.send(JSON.stringify({
              type: 'chat.user',
              sessionId: 'hermes-session-a',
              text: 'gm from Oasis',
              sentAt: Date.now(),
              messageId: 'chat-user-a',
            }))
          }
          if (msg.type === 'chat.agent.final') resolve(msg)
        })
      })
    })

    const hermesPort = await listen(hermesApi)
    const oasisPort = await listen(oasisApi)
    await relayReady
    const relayPort = relay.address().port

    const child = spawn(process.execPath, [
      'scripts/hermes-oasis-bridge.mjs',
      'OASIS-ABCDEFGH',
      `--oasis-url=http://127.0.0.1:${oasisPort}`,
      `--api-base=http://127.0.0.1:${hermesPort}/v1`,
      `--relay-url=ws://127.0.0.1:${relayPort}/?role=agent`,
      '--agent-slot=hermes:primary',
      '--no-mcp',
      '--no-mcp-config',
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })

    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })

    try {
      const final = await onceWithTimeout(finalMessage, 10_000, `Hermes final response. Output:\n${output}`)
      expect(final).toMatchObject({
        type: 'chat.agent.final',
        sessionId: 'hermes-session-a',
        text: 'hello world',
      })
      expect(responsesRequest).toMatchObject({
        input: 'gm from Oasis',
        conversation: 'oasis-hermes:primary-hermes-session-a',
        store: true,
        stream: true,
      })
      expect(responsesRequest.messages).toBeUndefined()
    } finally {
      child.kill('SIGTERM')
      relay.close()
      await closeHttp(hermesApi)
      await closeHttp(oasisApi)
    }
  })

  it('reconnects and flushes a queued final if the relay socket closes mid-turn', async () => {
    const hermesApi = http.createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/v1/health' || req.url === '/health')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'hermes-agent' }] }))
        return
      }
      if (req.method === 'POST' && req.url === '/v1/responses') {
        for await (const _chunk of req) {
          // drain request
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        await new Promise(resolve => setTimeout(resolve, 250))
        res.write('data: {"type":"response.output_text.delta","delta":"queued"}\n\n')
        res.write('data: {"type":"response.output_text.delta","delta":" final"}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(404)
      res.end('not found')
    })

    const oasisApi = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/api/relay/devices/exchange') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          deviceToken: 'dev_test_token',
          browserSessionId: 'bs_test',
          worldId: 'world_test',
          scopes: ['chat.stream', 'world.read', 'world.write.safe', 'screenshot.request'],
          agentType: 'hermes',
          agentSlot: 'hermes:primary',
          agentLabel: 'hermes-bridge',
        }))
        return
      }
      res.writeHead(404)
      res.end('not found')
    })

    const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    const relayReady = new Promise(resolve => relay.once('listening', resolve))
    let connectionCount = 0
    const finalMessage = new Promise(resolve => {
      relay.on('connection', ws => {
        connectionCount += 1
        const connectionNumber = connectionCount
        ws.send(JSON.stringify({
          type: 'relay.paired',
          role: 'agent',
          relaySessionId: `rs_test_${connectionNumber}`,
          sentAt: Date.now(),
          messageId: `relay-paired-${connectionNumber}`,
        }))
        ws.on('message', raw => {
          const msg = JSON.parse(raw.toString())
          if (connectionNumber === 1 && msg.type === 'agent.hello') {
            ws.send(JSON.stringify({
              type: 'chat.user',
              sessionId: 'hermes-session-reconnect',
              text: 'finish after reconnect',
              sentAt: Date.now(),
              messageId: 'chat-user-reconnect',
            }))
            setTimeout(() => ws.close(1012, 'test reconnect'), 30)
          }
          if (connectionNumber >= 2 && msg.type === 'chat.agent.final') resolve(msg)
        })
      })
    })

    const hermesPort = await listen(hermesApi)
    const oasisPort = await listen(oasisApi)
    await relayReady
    const relayPort = relay.address().port

    const child = spawn(process.execPath, [
      'scripts/hermes-oasis-bridge.mjs',
      'OASIS-ABCDEFGH',
      `--oasis-url=http://127.0.0.1:${oasisPort}`,
      `--api-base=http://127.0.0.1:${hermesPort}/v1`,
      `--relay-url=ws://127.0.0.1:${relayPort}/?role=agent`,
      '--agent-slot=hermes:primary',
      '--no-mcp',
      '--no-mcp-config',
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })

    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })

    try {
      const final = await onceWithTimeout(finalMessage, 10_000, `queued Hermes final after reconnect. Output:\n${output}`)
      expect(final).toMatchObject({
        type: 'chat.agent.final',
        sessionId: 'hermes-session-reconnect',
        text: 'queued final',
      })
      expect(connectionCount).toBeGreaterThanOrEqual(2)
    } finally {
      child.kill('SIGTERM')
      relay.close()
      await closeHttp(hermesApi)
      await closeHttp(oasisApi)
    }
  })
})
