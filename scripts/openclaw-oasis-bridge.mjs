#!/usr/bin/env node
/**
 * scripts/openclaw-oasis-bridge.mjs
 *
 * The user-side bridge process. Runs on the user's machine or VPS — wherever
 * their OpenClaw lives. v1 scope is intentionally narrow: prove the secure
 * transport end-to-end with a console chat experience. Gateway WS protocol
 * translation (full OpenClaw integration) lands in a follow-up.
 *
 * Lifecycle:
 *   1. Read pairing URL or bare code from argv / env.
 *   2. POST /api/relay/devices/exchange to swap code -> signed device token.
 *   3. Open WSS to <oasisUrl>/relay?role=agent with Authorization: Bearer <token>.
 *   4. Send agent.hello with deviceToken on `relay.paired` courtesy frame.
 *   5. Print incoming chat.user to stdout. Read replies from stdin and emit
 *      chat.agent.final back. Every line of stdin is one reply.
 *   6. Print incoming tool.call envelopes (no execution yet — will hook into
 *      OpenClaw Gateway protocol in v2).
 *
 * Run:
 *   node scripts/openclaw-oasis-bridge.mjs https://openclaw.04515.xyz/pair/OASIS-FULHDAL8
 *   node scripts/openclaw-oasis-bridge.mjs OASIS-FULHDAL8 --oasis-url=http://localhost:4516
 *   OASIS_PAIRING_URL=... OASIS_AGENT_LABEL=laptop node scripts/openclaw-oasis-bridge.mjs
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'

// ────────────────────────────────────────────────────────────────────────────
// Argv / env
// ────────────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const out = { positional: [], flags: {} }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq >= 0) out.flags[a.slice(2, eq)] = a.slice(eq + 1)
      else out.flags[a.slice(2)] = 'true'
    } else {
      out.positional.push(a)
    }
  }
  return out
}

const argv = parseArgv(process.argv.slice(2))
const rawCode = argv.positional[0] || process.env.OASIS_PAIRING_URL || ''
const labelOverride = argv.flags.label || process.env.OASIS_AGENT_LABEL || 'openclaw-bridge'
const oasisUrlOverride = argv.flags['oasis-url'] || process.env.OASIS_URL || ''

if (!rawCode) {
  console.error('usage: node scripts/openclaw-oasis-bridge.mjs <pairing-url-or-code> [--oasis-url=...] [--label=...]')
  process.exit(2)
}

function parsePairing(input) {
  const trimmed = input.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/(?:pair|p)\/([^/]+)/)
    const code = match ? decodeURIComponent(match[1]) : ''
    return { code, oasisUrl: `${url.protocol}//${url.host}` }
  }
  return { code: trimmed, oasisUrl: oasisUrlOverride || 'http://localhost:4516' }
}

const { code: pairingCode, oasisUrl } = parsePairing(rawCode)
if (!pairingCode || !pairingCode.startsWith('OASIS-')) {
  console.error('[bridge] could not extract a valid OASIS-XXXXXXXX code from input:', rawCode)
  process.exit(2)
}
// CLI flag wins over the host derived from the pairing URL.
const finalOasisUrl = oasisUrlOverride || oasisUrl

const log = (...args) => console.log('[bridge]', ...args)

log('pairing target:', { oasisUrl: finalOasisUrl, code: pairingCode, label: labelOverride })

// ────────────────────────────────────────────────────────────────────────────
// Step 1: exchange pairing code -> device token
// ────────────────────────────────────────────────────────────────────────────

async function exchangePairingCode() {
  const url = `${finalOasisUrl.replace(/\/+$/, '')}/api/relay/devices/exchange`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingCode,
      agentLabel: labelOverride,
      agentVersion: '0.1.0-bridge-v1',
    }),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`exchange returned non-JSON (status ${response.status}): ${text.slice(0, 200)}`) }
  if (!response.ok || !json?.ok) {
    const code = json?.error?.code || 'exchange_failed'
    const message = json?.error?.message || `exchange failed with status ${response.status}`
    throw new Error(`[${code}] ${message}`)
  }
  return {
    deviceToken: json.deviceToken,
    browserSessionId: json.browserSessionId,
    worldId: json.worldId,
    scopes: json.scopes,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2: connect to relay with token
// ────────────────────────────────────────────────────────────────────────────

function buildRelayUrl(httpUrl) {
  const base = httpUrl.replace(/\/+$/, '')
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}/relay?role=agent`
  if (base.startsWith('http://'))  return `ws://${base.slice('http://'.length)}/relay?role=agent`
  return `ws://${base}/relay?role=agent`
}

let ws = null
let exited = false

const exitWith = (code, reason) => {
  if (exited) return
  exited = true
  log('exit', { code, reason })
  try { ws?.close() } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 50).unref()
}

function send(msg) {
  if (!ws || ws.readyState !== ws.OPEN) {
    log('cannot send — socket not open', { type: msg.type })
    return
  }
  const enriched = { messageId: randomUUID(), sentAt: Date.now(), ...msg }
  ws.send(JSON.stringify(enriched))
}

async function start() {
  log('exchanging pairing code …')
  let creds
  try {
    creds = await exchangePairingCode()
  } catch (err) {
    log('exchange failed:', err?.message || String(err))
    exitWith(3, 'exchange_failed')
    return
  }
  log('paired:', { browserSessionId: creds.browserSessionId, worldId: creds.worldId, scopes: creds.scopes })

  // Allow override of relay URL for split-deploy topologies (relay on a
  // different host than the Next app). Default: same host.
  const explicitRelay = argv.flags['relay-url'] || process.env.OASIS_RELAY_URL || ''
  const relayUrl = explicitRelay || buildRelayUrl(finalOasisUrl)
  log('connecting to relay:', relayUrl)

  ws = new WebSocket(relayUrl, {
    headers: {
      authorization: `Bearer ${creds.deviceToken}`,
    },
  })

  ws.on('open', () => log('relay socket open'))

  ws.on('message', (raw) => {
    let parsed
    try { parsed = JSON.parse(raw.toString()) } catch {
      log('non-JSON frame ignored')
      return
    }

    if (parsed.type === 'relay.paired') {
      log('paired by relay:', { relaySessionId: parsed.relaySessionId })
      send({
        type: 'agent.hello',
        deviceToken: creds.deviceToken,
        agentLabel: labelOverride,
        agentVersion: '0.1.0-bridge-v1',
      })
      return
    }

    if (parsed.type === 'chat.user') {
      console.log(`\n[user] ${parsed.text}`)
      console.log('[bridge] type a reply, then enter:')
      return
    }

    if (parsed.type === 'tool.call') {
      log('tool.call received (no executor wired yet in v1 bridge):', { toolName: parsed.toolName, callId: parsed.callId })
      // Reply with a polite stub so the browser doesn't hang waiting.
      send({
        type: 'tool.result',
        callId: parsed.callId,
        ok: false,
        error: {
          code: 'bridge_no_executor',
          message: 'v1 bridge does not yet route tool calls through OpenClaw; wire Gateway WS in v2',
        },
      })
      return
    }

    if (parsed.type === 'error') {
      log('relay error:', parsed)
      return
    }

    log('unhandled envelope:', { type: parsed.type })
  })

  ws.on('close', (code, reason) => {
    log('relay socket closed', { code, reason: reason?.toString?.() })
    if (!exited) exitWith(0, 'closed')
  })

  ws.on('error', (err) => {
    log('relay socket error:', err?.message || String(err))
    if (!exited) exitWith(5, 'socket_error')
  })

  // Stdin -> chat.agent.final
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  rl.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    send({
      type: 'chat.agent.final',
      sessionId: 'bridge-console',
      text,
    })
  })
}

start().catch((err) => {
  log('fatal:', err?.message || String(err))
  exitWith(1, 'fatal')
})

process.on('SIGINT',  () => exitWith(0, 'SIGINT'))
process.on('SIGTERM', () => exitWith(0, 'SIGTERM'))
