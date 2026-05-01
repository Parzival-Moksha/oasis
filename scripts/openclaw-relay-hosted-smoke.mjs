#!/usr/bin/env node
/**
 * scripts/openclaw-relay-hosted-smoke.mjs
 *
 * End-to-end smoke for the production-shape relay path. Exercises every
 * authenticated step the hosted deployment will use:
 *
 *   1. GET /api/session/init           → mint signed cookie
 *   2. POST /api/relay/pairings        → create pairing code (cookie-bound)
 *   3. POST /api/relay/devices/exchange → swap code → signed device token
 *   4. WSS browser  → cookie + Origin upgrade auth
 *   5. WSS agent    → Bearer token upgrade auth
 *   6. Send a chat.user from "browser", expect forward to agent
 *   7. Send a chat.agent.final from agent, expect forward to browser
 *   8. Send tool.call with a granted scope, expect forward
 *   9. Send tool.call with a denied scope, expect a synthetic tool.result
 *
 * Env:
 *   OASIS_URL    base http(s) URL of the Next app, default http://localhost:4516
 *   RELAY_URL    base ws(s) URL of the hosted relay,  default derived from OASIS_URL
 *   WORLD_ID     world id to bind into the pairing token, default world-welcome-hub-system
 *
 * Exit codes:
 *   0 all assertions pass
 *   1 assertion failure
 *   2 setup/exchange failure
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const OASIS_URL = (process.env.OASIS_URL || 'http://localhost:4516').replace(/\/+$/, '')
const RELAY_URL = (process.env.RELAY_URL || OASIS_URL.replace(/^http/, 'ws')).replace(/\/+$/, '')
const ORIGIN = process.env.OASIS_ORIGIN || OASIS_URL
const WORLD_ID = process.env.WORLD_ID || process.env.OASIS_WORLD_ID || 'world-welcome-hub-system'

// In production behind Nginx, the WS upgrade lives at /relay (the proxy passes
// it through to the sidecar). When running against a bare dev sidecar that
// listens on `/`, set RELAY_PATH='' to skip the segment.
const RELAY_PATH = process.env.RELAY_PATH ?? (
  RELAY_URL.includes('://localhost') || RELAY_URL.includes('://127.0.0.1') ? '' : '/relay'
)

function relayUrlFor(role) {
  return `${RELAY_URL}${RELAY_PATH}/?role=${role}`.replace(/\/\?/, '?')
}

const log = (...args) => console.log('[smoke]', ...args)

function fail(reason, detail) {
  console.error('[smoke] FAIL:', reason, detail ?? '')
  process.exit(1)
}

async function step1_mintCookie() {
  const url = `${OASIS_URL}/api/session/init`
  const response = await fetch(url)
  const cookieHeader = response.headers.get('set-cookie') || ''
  const match = cookieHeader.match(/oasis_session=([^;]+)/)
  if (!match) fail('no oasis_session in Set-Cookie', cookieHeader)
  const json = await response.json()
  log('1. cookie minted', { browserSessionId: json.browserSessionId })
  return { cookieValue: `oasis_session=${match[1]}`, browserSessionId: json.browserSessionId }
}

async function step2_pair(cookieHeader) {
  const response = await fetch(`${OASIS_URL}/api/relay/pairings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
    body: JSON.stringify({ worldId: WORLD_ID }),
  })
  const json = await response.json()
  if (!response.ok || !json?.ok) fail('pairings POST failed', json)
  log('2. pairing code', { code: json.code, scopes: json.scopes })
  return json
}

async function step3_exchange(code) {
  const response = await fetch(`${OASIS_URL}/api/relay/devices/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingCode: code, agentLabel: 'smoke' }),
  })
  const json = await response.json()
  if (!response.ok || !json?.ok) fail('exchange POST failed', json)
  log('3. device token issued', { scopes: json.scopes, len: json.deviceToken.length })
  return json
}

function openSocket({ url, headers, role, label }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    const inbox = []
    let waitingResolver = null
    ws.on('open', () => {
      log(`   ${label} socket open`)
      resolve({
        ws,
        send: (msg) => {
          const enriched = { messageId: randomUUID(), sentAt: Date.now(), ...msg }
          ws.send(JSON.stringify(enriched))
        },
        next: (timeoutMs = 3000) => new Promise((res, rej) => {
          if (inbox.length > 0) return res(inbox.shift())
          const timer = setTimeout(() => {
            waitingResolver = null
            rej(new Error(`${label} timed out waiting for next frame`))
          }, timeoutMs)
          waitingResolver = (msg) => { clearTimeout(timer); res(msg) }
        }),
        close: () => { try { ws.close() } catch { /* ignore */ } },
      })
    })
    ws.on('message', (raw) => {
      let parsed
      try { parsed = JSON.parse(raw.toString()) } catch { return }
      if (waitingResolver) {
        const r = waitingResolver
        waitingResolver = null
        r(parsed)
      } else {
        inbox.push(parsed)
      }
    })
    ws.on('error', (err) => {
      log(`   ${label} error`, err?.message || String(err))
      reject(err)
    })
    ws.on('unexpected-response', (req, res) => {
      reject(new Error(`${label} upgrade rejected: HTTP ${res.statusCode}`))
    })
  })
}

async function main() {
  log('OASIS_URL =', OASIS_URL)
  log('RELAY_URL =', RELAY_URL)

  let cookieHeader, browserSessionId, code, deviceToken
  try {
    const c = await step1_mintCookie()
    cookieHeader = c.cookieValue
    browserSessionId = c.browserSessionId
    const p = await step2_pair(cookieHeader)
    code = p.code
    const e = await step3_exchange(code)
    deviceToken = e.deviceToken
  } catch (err) {
    console.error('[smoke] setup failed:', err?.message || err)
    process.exit(2)
  }

  log('4. opening browser socket with cookie + Origin')
  const browser = await openSocket({
    url: relayUrlFor('browser'),
    headers: { cookie: cookieHeader, origin: ORIGIN },
    role: 'browser',
    label: 'browser',
  })
  log('5. opening agent socket with Bearer token')
  const agent = await openSocket({
    url: relayUrlFor('agent'),
    headers: { authorization: `Bearer ${deviceToken}` },
    role: 'agent',
    label: 'agent',
  })

  // Both sides should receive a `relay.paired` courtesy frame.
  const browserPaired = await browser.next(3000)
  const agentPaired = await agent.next(3000)
  if (browserPaired.type !== 'relay.paired') fail('browser missed relay.paired', browserPaired)
  if (agentPaired.type !== 'relay.paired')   fail('agent missed relay.paired',   agentPaired)
  log('6. both peers received relay.paired:', { relaySessionId: browserPaired.relaySessionId })

  // 7. browser → agent: chat.user
  browser.send({ type: 'chat.user', sessionId: 's1', text: 'hello agent' })
  const recvOnAgent = await agent.next(3000)
  if (recvOnAgent.type !== 'chat.user' || recvOnAgent.text !== 'hello agent') {
    fail('agent did not receive chat.user verbatim', recvOnAgent)
  }
  log('7. chat.user forwarded browser → agent')

  // 8. agent → browser: chat.agent.final
  agent.send({ type: 'chat.agent.final', sessionId: 's1', text: 'hello browser' })
  const recvOnBrowser = await browser.next(3000)
  if (recvOnBrowser.type !== 'chat.agent.final' || recvOnBrowser.text !== 'hello browser') {
    fail('browser did not receive chat.agent.final verbatim', recvOnBrowser)
  }
  log('8. chat.agent.final forwarded agent → browser')

  // 9. tool.call with granted scope
  const callId1 = randomUUID()
  agent.send({
    type: 'tool.call', callId: callId1,
    toolName: 'get_world_info', args: {}, scope: 'world.read',
  })
  const recvCall = await browser.next(3000)
  if (recvCall.type !== 'tool.call' || recvCall.callId !== callId1) {
    fail('granted-scope tool.call not forwarded to browser', recvCall)
  }
  log('9. tool.call (granted scope) forwarded')

  // 10. tool.call with denied scope → relay must short-circuit with synthetic tool.result
  const callId2 = randomUUID()
  agent.send({
    type: 'tool.call', callId: callId2,
    toolName: 'voice_realtime_open', args: {}, scope: 'voice.realtime',
  })
  const recvDenied = await agent.next(3000)
  if (recvDenied.type !== 'tool.result' || recvDenied.callId !== callId2 || recvDenied.ok !== false) {
    fail('relay did not short-circuit denied-scope tool.call', recvDenied)
  }
  if (recvDenied.error?.code !== 'scope_denied') {
    fail('expected scope_denied error', recvDenied)
  }
  log('10. tool.call (denied scope) short-circuited with scope_denied')

  log('PASS — hosted relay end-to-end auth + routing + scope enforcement')
  browser.close()
  agent.close()
  setTimeout(() => process.exit(0), 100).unref()
}

main().catch((err) => {
  console.error('[smoke] fatal:', err?.message || err)
  process.exit(1)
})
