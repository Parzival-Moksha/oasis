import { afterEach, describe, expect, it } from 'vitest'

import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'

const children = []
const sockets = []

afterEach(async () => {
  while (sockets.length > 0) {
    const ws = sockets.pop()
    try { ws.close() } catch { /* ignore */ }
  }
  while (children.length > 0) {
    const child = children.pop()
    child.kill('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
})

function sign(payload, key) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sigB64 = createHmac('sha256', key).update(payloadB64).digest().toString('base64url')
  return `${payloadB64}.${sigB64}`
}

function onceMessage(ws, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for websocket message'))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      ws.off('error', onError)
    }
    function onMessage(raw) {
      cleanup()
      resolve(JSON.parse(raw.toString()))
    }
    function onClose(code, reason) {
      cleanup()
      reject(new Error(`socket closed before message: ${code} ${reason?.toString?.() || ''}`))
    }
    function onError(error) {
      cleanup()
      reject(error)
    }
    ws.on('message', onMessage)
    ws.on('close', onClose)
    ws.on('error', onError)
  })
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for websocket open'))
    }, 1200)
    function cleanup() {
      clearTimeout(timer)
      ws.off('open', onOpen)
      ws.off('close', onClose)
      ws.off('error', onError)
    }
    function onOpen() {
      cleanup()
      resolve()
    }
    function onClose(code, reason) {
      cleanup()
      reject(new Error(`socket closed before open: ${code} ${reason?.toString?.() || ''}`))
    }
    function onError(error) {
      cleanup()
      reject(error)
    }
    ws.on('open', onOpen)
    ws.on('close', onClose)
    ws.on('error', onError)
  })
}

async function startRelay() {
  const port = 48000 + Math.floor(Math.random() * 1000)
  const signingKey = randomBytes(24).toString('hex')
  const child = spawn(process.execPath, ['scripts/openclaw-relay.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELAY_PORT: String(port),
      RELAY_SIGNING_KEY: signingKey,
      RELAY_ALLOWED_ORIGINS: 'http://localhost:4516',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  const output = []
  child.stdout.on('data', chunk => output.push(chunk.toString()))
  child.stderr.on('data', chunk => output.push(chunk.toString()))

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`relay did not start:\n${output.join('')}`))
    }, 2000)
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`relay exited before listening: ${code}\n${output.join('')}`))
    })
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`listening on :${port}`)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })

  return { port, signingKey }
}

function openBrowserSocket({ port, signingKey, browserSessionId }) {
  const token = sign({ bs: browserSessionId, iat: Date.now() }, signingKey)
  const ws = new WebSocket(`ws://127.0.0.1:${port}?role=browser`, {
    headers: {
      cookie: `oasis_session=${encodeURIComponent(token)}`,
      origin: 'http://localhost:4516',
    },
  })
  sockets.push(ws)
  return ws
}

function openAgentSocket({ port, signingKey, browserSessionId }) {
  const token = sign({
    bs: browserSessionId,
    w: 'world-test',
    scopes: ['chat.stream', 'world.read'],
    exp: Date.now() + 60_000,
    label: 'test-agent',
  }, signingKey)
  const ws = new WebSocket(`ws://127.0.0.1:${port}?role=agent`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  sockets.push(ws)
  return ws
}

describe('hosted OpenClaw relay peer lifecycle', () => {
  it('keeps the agent bridge connected when the browser tab refreshes', async () => {
    const relay = await startRelay()
    const browserSessionId = `bs_${randomBytes(8).toString('hex')}`

    const browser = openBrowserSocket({ ...relay, browserSessionId })
    const agent = openAgentSocket({ ...relay, browserSessionId })
    await Promise.all([waitForOpen(browser), waitForOpen(agent)])
    expect(await onceMessage(browser)).toMatchObject({ type: 'relay.paired', role: 'browser' })
    expect(await onceMessage(agent)).toMatchObject({ type: 'relay.paired', role: 'agent' })

    browser.close(1000, 'simulated refresh')
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(agent.readyState).toBe(WebSocket.OPEN)

    const refreshedBrowser = openBrowserSocket({ ...relay, browserSessionId })
    await waitForOpen(refreshedBrowser)
    expect(await onceMessage(refreshedBrowser)).toMatchObject({ type: 'relay.paired', role: 'browser' })
    expect(await onceMessage(agent)).toMatchObject({ type: 'relay.paired', role: 'agent' })

    refreshedBrowser.send(JSON.stringify({
      type: 'chat.user',
      sessionId: 'session-a',
      text: 'gm',
      messageId: 'msg-a',
      sentAt: Date.now(),
    }))
    expect(await onceMessage(agent)).toMatchObject({
      type: 'chat.user',
      sessionId: 'session-a',
      text: 'gm',
    })
  })
})
