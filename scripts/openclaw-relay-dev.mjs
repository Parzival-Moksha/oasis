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
 * - Enforces an 8 MiB default frame cap; rejects binary; logs every connection.
 *
 * No auth. No TLS. No persistence. The hosted relay (`scripts/openclaw-relay.mjs`,
 * future) replaces this with pairing codes, device tokens, scope checks, and
 * a per-message zod validator imported from src/lib/relay/protocol.ts.
 *
 * Run:
 *   node scripts/openclaw-relay-dev.mjs
 *   RELAY_PORT=4520 node scripts/openclaw-relay-dev.mjs
 *   RELAY_FRAME_MAX_BYTES=16777216 node scripts/openclaw-relay-dev.mjs
 */

import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.RELAY_PORT || 4517)
const FRAME_MAX_BYTES = Math.max(256 * 1024, Number(process.env.RELAY_FRAME_MAX_BYTES || 8 * 1024 * 1024))

const log = (...args) => {
  // ISO timestamp + tag — keeps PM2 logs grep-friendly later.
  console.log('[relay-dev]', new Date().toISOString(), ...args)
}

const wss = new WebSocketServer({ port: PORT, maxPayload: FRAME_MAX_BYTES })

wss.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[relay-dev] port ${PORT} is already in use. A relay may already be running.`)
    console.error(`[relay-dev] Use the existing relay, stop the owning process, or run: $env:RELAY_PORT=4520; pnpm dev:relay`)
    console.error(`[relay-dev] Windows owner check: Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object OwningProcess`)
    process.exit(1)
  }
  console.error('[relay-dev] fatal server error:', err?.message || String(err))
  process.exit(1)
})

const waitingBrowsers = new Map()
const waitingAgents = new Map()
const pairs = new Map() // ws -> peer ws

function cleanAgentSlot(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw || 'openclaw:primary'
}

function unpair(ws) {
  const peer = pairs.get(ws)
  if (peer) {
    pairs.delete(ws)
    pairs.delete(peer)
    if (peer.readyState === peer.OPEN) {
      try { peer.close(1001, 'peer disconnected') } catch { /* ignore */ }
    }
  }
  for (const [slot, waiting] of waitingBrowsers.entries()) {
    if (waiting === ws) waitingBrowsers.delete(slot)
  }
  for (const [slot, waiting] of waitingAgents.entries()) {
    if (waiting === ws) waitingAgents.delete(slot)
  }
}

function tryPair(agentSlot) {
  const browser = waitingBrowsers.get(agentSlot)
  const agent = waitingAgents.get(agentSlot)
  if (!browser || !agent) return
  waitingBrowsers.delete(agentSlot)
  waitingAgents.delete(agentSlot)
  pairs.set(browser, agent)
  pairs.set(agent, browser)

  const relaySessionId = randomUUID()
  log('paired', { relaySessionId, agentSlot })

  const courtesy = (role) => JSON.stringify({
    // Sidecar courtesy frame — not part of the wire vocabulary.
    // Bridges may listen for it to learn their relaySessionId before sending hello.
    type: 'relay.paired',
    role,
    relaySessionId,
    agentSlot,
    sentAt: Date.now(),
    messageId: randomUUID(),
  })

  try { browser.send(courtesy('browser')) } catch (err) { log('send courtesy browser failed', err?.message) }
  try { agent.send(  courtesy('agent'))   } catch (err) { log('send courtesy agent failed',   err?.message) }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const role = url.searchParams.get('role')
  const agentSlot = cleanAgentSlot(url.searchParams.get('agentSlot'))
  const remote = req.socket?.remoteAddress
  log('connection', { role, agentSlot, remote })

  if (role !== 'browser' && role !== 'agent') {
    ws.close(1008, 'role query param required (browser|agent)')
    return
  }

  if (role === 'browser') {
    const waitingBrowser = waitingBrowsers.get(agentSlot)
    if (waitingBrowser && waitingBrowser.readyState === waitingBrowser.OPEN) {
      log('replacing waiting browser', { agentSlot })
      try { waitingBrowser.close(1001, 'replaced by newer browser') } catch { /* ignore */ }
    }
    waitingBrowsers.set(agentSlot, ws)
  } else {
    const waitingAgent = waitingAgents.get(agentSlot)
    if (waitingAgent && waitingAgent.readyState === waitingAgent.OPEN) {
      log('replacing waiting agent', { agentSlot })
      try { waitingAgent.close(1001, 'replaced by newer agent') } catch { /* ignore */ }
    }
    waitingAgents.set(agentSlot, ws)
  }

  tryPair(agentSlot)

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
    log('disconnect', { role, agentSlot, code, reason: reason?.toString?.() })
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
