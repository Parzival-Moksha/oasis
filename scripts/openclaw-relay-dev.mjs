#!/usr/bin/env node
/**
 * scripts/openclaw-relay-dev.mjs
 *
 * Local development sidecar for the OpenClaw relay. NOT FOR PRODUCTION.
 *
 * - Listens on RELAY_PORT (default 4517).
 * - Accepts two roles via querystring: ?role=browser and ?role=agent.
 * - Naively pairs the first browser with the first agent (FIFO single pair).
 * - Forwards every JSON frame between paired peers.
 * - Enforces 256 KB frame cap; rejects binary; logs every connection.
 *
 * No auth. No TLS. No persistence. The hosted relay (`scripts/openclaw-relay.mjs`,
 * future) replaces this with pairing codes, device tokens, scope checks, and
 * a per-message zod validator imported from src/lib/relay/protocol.ts.
 *
 * Run:
 *   node scripts/openclaw-relay-dev.mjs
 *   RELAY_PORT=4520 node scripts/openclaw-relay-dev.mjs
 */

import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.RELAY_PORT || 4517)
const FRAME_MAX_BYTES = 256 * 1024

const log = (...args) => {
  // ISO timestamp + tag — keeps PM2 logs grep-friendly later.
  console.log('[relay-dev]', new Date().toISOString(), ...args)
}

const wss = new WebSocketServer({ port: PORT, maxPayload: FRAME_MAX_BYTES })

let waitingBrowser = null
let waitingAgent = null
const pairs = new Map() // ws -> peer ws

function unpair(ws) {
  const peer = pairs.get(ws)
  if (peer) {
    pairs.delete(ws)
    pairs.delete(peer)
    if (peer.readyState === peer.OPEN) {
      try { peer.close(1001, 'peer disconnected') } catch { /* ignore */ }
    }
  }
  if (waitingBrowser === ws) waitingBrowser = null
  if (waitingAgent   === ws) waitingAgent   = null
}

function tryPair() {
  if (!waitingBrowser || !waitingAgent) return
  const browser = waitingBrowser
  const agent = waitingAgent
  waitingBrowser = null
  waitingAgent = null
  pairs.set(browser, agent)
  pairs.set(agent, browser)

  const relaySessionId = randomUUID()
  log('paired', { relaySessionId })

  const courtesy = (role) => JSON.stringify({
    // Sidecar courtesy frame — not part of the wire vocabulary.
    // Bridges may listen for it to learn their relaySessionId before sending hello.
    type: 'relay.paired',
    role,
    relaySessionId,
    sentAt: Date.now(),
    messageId: randomUUID(),
  })

  try { browser.send(courtesy('browser')) } catch (err) { log('send courtesy browser failed', err?.message) }
  try { agent.send(  courtesy('agent'))   } catch (err) { log('send courtesy agent failed',   err?.message) }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const role = url.searchParams.get('role')
  const remote = req.socket?.remoteAddress
  log('connection', { role, remote })

  if (role !== 'browser' && role !== 'agent') {
    ws.close(1008, 'role query param required (browser|agent)')
    return
  }

  if (role === 'browser') {
    if (waitingBrowser && waitingBrowser.readyState === waitingBrowser.OPEN) {
      log('replacing waiting browser')
      try { waitingBrowser.close(1001, 'replaced by newer browser') } catch { /* ignore */ }
    }
    waitingBrowser = ws
  } else {
    if (waitingAgent && waitingAgent.readyState === waitingAgent.OPEN) {
      log('replacing waiting agent')
      try { waitingAgent.close(1001, 'replaced by newer agent') } catch { /* ignore */ }
    }
    waitingAgent = ws
  }

  tryPair()

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      ws.close(1003, 'binary frames not supported')
      return
    }
    const peer = pairs.get(ws)
    if (!peer || peer.readyState !== peer.OPEN) {
      // Not paired yet, or peer disappeared. Drop silently — bridges
      // should not depend on the relay for delivery semantics.
      return
    }
    try {
      peer.send(raw.toString())
    } catch (err) {
      log('forward failed', { role, err: err?.message })
    }
  })

  ws.on('close', (code, reason) => {
    log('disconnect', { role, code, reason: reason?.toString?.() })
    unpair(ws)
  })

  ws.on('error', (err) => {
    log('socket error', { role, err: err?.message || String(err) })
  })
})

wss.on('listening', () => {
  log(`listening on ws://localhost:${PORT}/?role=browser|agent  (max frame ${FRAME_MAX_BYTES} bytes)`)
})

const shutdown = (signal) => {
  log('shutting down', { signal })
  wss.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 2000).unref()
}
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
