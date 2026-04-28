#!/usr/bin/env node
/**
 * scripts/openclaw-fake-browser.mjs
 *
 * Stand-in for the real browser bridge. Connects to the dev sidecar as
 * role=browser and echoes every `tool.call` back as a fake `tool.result`.
 * Used together with `openclaw-fake-bridge.mjs` to prove relay routing
 * without booting Next.js or the 3D scene.
 *
 * Run:
 *   node scripts/openclaw-fake-browser.mjs
 *   RELAY_URL=ws://localhost:4520/?role=browser node scripts/openclaw-fake-browser.mjs
 *   FAKE_BROWSER_LIFETIME_MS=5000 node scripts/openclaw-fake-browser.mjs   # auto-exit
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:4517/?role=browser'
const LIFETIME_MS = Number(process.env.FAKE_BROWSER_LIFETIME_MS || 0) // 0 = run until killed

const log = (...args) => console.log('[fake-browser]', ...args)

const ws = new WebSocket(RELAY_URL)

const send = (msg) => {
  const enriched = { messageId: randomUUID(), sentAt: Date.now(), ...msg }
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
      type:             'browser.hello',
      browserSessionId: 'fake-browser-session',
      worldId:          'fake-world',
      roomId:           'fake-room',
    })
    return
  }

  if (parsed.type === 'tool.call') {
    send({
      type:   'tool.result',
      callId: parsed.callId,
      ok:     true,
      data:   {
        echoedTool: parsed.toolName,
        echoedArgs: parsed.args ?? {},
        note:       'fake-browser stub result — replace with real executor in src/hooks/useOpenclawRelayBridge.ts',
      },
    })
    return
  }
})

ws.on('close', (code, reason) => {
  log('socket closed', { code, reason: reason?.toString?.() })
  process.exit(0)
})

ws.on('error', (err) => {
  log('error', err?.message || String(err))
  process.exit(1)
})

if (LIFETIME_MS > 0) {
  setTimeout(() => {
    log('lifetime elapsed, exiting')
    try { ws.close() } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 50).unref()
  }, LIFETIME_MS).unref()
}
