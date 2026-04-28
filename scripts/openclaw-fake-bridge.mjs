#!/usr/bin/env node
/**
 * scripts/openclaw-fake-bridge.mjs
 *
 * Stand-in for the real OpenClaw-side bridge. Used to smoke-test the relay
 * round trip without depending on a running OpenClaw Gateway.
 *
 * Behaviour:
 *   1. Connect to the dev relay sidecar as role=agent.
 *   2. Wait for the sidecar's `relay.paired` courtesy frame.
 *   3. Send `agent.hello` with a dev pairing code.
 *   4. Send one `tool.call { toolName: 'get_world_info' }`.
 *   5. Print whatever `tool.result` (or `error`) comes back, exit accordingly.
 *
 * Run:
 *   node scripts/openclaw-fake-bridge.mjs
 *   RELAY_URL=ws://localhost:4520/?role=agent node scripts/openclaw-fake-bridge.mjs
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:4517/?role=agent'
const TIMEOUT_MS = Number(process.env.FAKE_BRIDGE_TIMEOUT_MS || 8_000)

const log = (...args) => console.log('[fake-bridge]', ...args)

const ws = new WebSocket(RELAY_URL)

let exited = false
const exitWith = (code, reason) => {
  if (exited) return
  exited = true
  log('exit', { code, reason })
  try { ws.close() } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 50).unref()
}

const watchdog = setTimeout(() => {
  exitWith(2, `timeout after ${TIMEOUT_MS}ms with no tool.result`)
}, TIMEOUT_MS)
watchdog.unref()

const send = (msg) => {
  const enriched = {
    messageId: randomUUID(),
    sentAt: Date.now(),
    ...msg,
  }
  ws.send(JSON.stringify(enriched))
  log('-> sent', msg.type, msg.callId ?? '')
}

ws.on('open', () => {
  log('connected to', RELAY_URL)
})

ws.on('message', (raw) => {
  let parsed
  try {
    parsed = JSON.parse(raw.toString())
  } catch {
    log('<- non-JSON frame ignored:', raw.toString().slice(0, 200))
    return
  }
  log('<- recv', parsed.type)

  if (parsed.type === 'relay.paired') {
    send({
      type: 'agent.hello',
      pairingCode: 'DEV-LOCAL',
      agentLabel:  'fake-bridge',
      agentVersion:'0.0.1',
    })

    setTimeout(() => {
      send({
        type:     'tool.call',
        callId:   randomUUID(),
        toolName: 'get_world_info',
        args:     {},
        scope:    'world.read',
      })
    }, 200)
    return
  }

  if (parsed.type === 'tool.result') {
    log('tool.result:', JSON.stringify(parsed, null, 2))
    exitWith(parsed.ok ? 0 : 1, parsed.ok ? 'ok' : 'tool reported failure')
    return
  }

  if (parsed.type === 'error') {
    log('relay error:', parsed)
    exitWith(3, 'relay error')
    return
  }
})

ws.on('close', (code, reason) => {
  log('socket closed', { code, reason: reason?.toString?.() })
  if (!exited) exitWith(4, 'socket closed before result')
})

ws.on('error', (err) => {
  log('error', err?.message || String(err))
  exitWith(5, 'socket error')
})
