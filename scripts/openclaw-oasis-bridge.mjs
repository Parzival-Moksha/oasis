#!/usr/bin/env node
/**
 * scripts/openclaw-oasis-bridge.mjs
 *
 * The user-side bridge process. Runs on the user's machine — wherever their
 * OpenClaw lives. v2 of the bridge: real chat translation between the hosted
 * relay and a local OpenClaw Gateway via the v3 WS protocol.
 *
 * Lifecycle:
 *   1. Parse pairing URL or bare code from argv / env.
 *   2. POST /api/relay/devices/exchange to swap code → signed device token.
 *   3. Open WSS to <oasisUrl>/relay?role=agent with `Authorization: Bearer …`.
 *   4. Load (or generate) the persistent device identity at IDENTITY_PATH.
 *   5. Open WS to local OpenClaw Gateway (default ws://127.0.0.1:18789),
 *      complete the v3 Ed25519 challenge handshake.
 *   6. On `chat.user` from the relay → call `chat.send` on the Gateway,
 *      stream Gateway `chat` events back as `chat.agent.delta`/`final`.
 *   7. Start a local Streamable HTTP MCP adapter. OpenClaw calls Oasis tools
 *      locally; the adapter proxies them through relay `tool.call` frames and
 *      waits for browser-executed `tool.result` frames.
 *
 * Env / flags:
 *   --gateway-url=...        OPENCLAW_GATEWAY_URL    default ws://127.0.0.1:18789
 *   --gateway-token=...      OPENCLAW_GATEWAY_TOKEN  optional shared token
 *                                                    (some Gateway configs require)
 *   --identity=...           OPENCLAW_BRIDGE_IDENTITY default ~/.openclaw-oasis-bridge/identity.json
 *   --mcp-port=...           OASIS_BRIDGE_MCP_PORT default 17890
 *   --mcp-host=...           OASIS_BRIDGE_MCP_HOST default 127.0.0.1
 *   --tool-timeout-ms=...    OASIS_BRIDGE_TOOL_TIMEOUT_MS default 30000
 *   --no-gateway             skip Gateway entirely (legacy stdin-echo mode)
 *   --no-mcp                 skip the local MCP adapter
 *
 * Run:
 *   node scripts/openclaw-oasis-bridge.mjs https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
import os from 'node:os'
import path from 'node:path'

import { GatewayClient, loadOrCreateIdentity } from './openclaw-gateway-shim.mjs'
import { startBridgeMcpServer } from './openclaw-bridge-mcp.mjs'

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
const gatewayUrlOverride = argv.flags['gateway-url'] || process.env.OPENCLAW_GATEWAY_URL || ''
const gatewaySharedToken = argv.flags['gateway-token'] || process.env.OPENCLAW_GATEWAY_TOKEN || ''
const identityPathOverride = argv.flags.identity || process.env.OPENCLAW_BRIDGE_IDENTITY || ''
const skipGateway = argv.flags['no-gateway'] === 'true'
const skipMcp = argv.flags['no-mcp'] === 'true'
const mcpHost = argv.flags['mcp-host'] || process.env.OASIS_BRIDGE_MCP_HOST || '127.0.0.1'
const mcpPort = Number(argv.flags['mcp-port'] || process.env.OASIS_BRIDGE_MCP_PORT || 17890)
const toolTimeoutMs = Number(argv.flags['tool-timeout-ms'] || process.env.OASIS_BRIDGE_TOOL_TIMEOUT_MS || 30_000)

if (!rawCode) {
  console.error('usage: node scripts/openclaw-oasis-bridge.mjs <pairing-url-or-code>')
  console.error('  optional: --oasis-url=https://… --gateway-url=ws://127.0.0.1:18789')
  console.error('  optional: --gateway-token=… --identity=… --label=… --mcp-port=17890')
  console.error('  optional: --no-gateway --no-mcp')
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
const finalOasisUrl = oasisUrlOverride || oasisUrl
const finalGatewayUrl = gatewayUrlOverride || 'ws://127.0.0.1:18789'
const identityPath = identityPathOverride || path.join(os.homedir(), '.openclaw-oasis-bridge', 'identity.json')

const log = (...args) => console.log('[bridge]', ...args)

log('config:', {
  oasisUrl: finalOasisUrl,
  code: pairingCode,
  label: labelOverride,
  gateway: skipGateway ? '(skipped)' : finalGatewayUrl,
  mcp: skipMcp ? '(skipped)' : `http://${mcpHost}:${mcpPort}/mcp`,
  identityPath,
})

// ────────────────────────────────────────────────────────────────────────────
// Step 1: exchange pairing code → device token
// ────────────────────────────────────────────────────────────────────────────

async function exchangePairingCode() {
  const url = `${finalOasisUrl.replace(/\/+$/, '')}/api/relay/devices/exchange`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingCode,
      agentLabel: labelOverride,
      agentVersion: '0.3.0-bridge-tools',
    }),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) }
  catch { throw new Error(`exchange returned non-JSON (status ${response.status}): ${text.slice(0, 200)}`) }
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

function buildRelayUrl(httpUrl) {
  const base = httpUrl.replace(/\/+$/, '')
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}/relay?role=agent`
  if (base.startsWith('http://'))  return `ws://${base.slice('http://'.length)}/relay?role=agent`
  return `ws://${base}/relay?role=agent`
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle wiring
// ────────────────────────────────────────────────────────────────────────────

let relayWs = null
let gateway = null
let mcpServer = null
let exited = false
const pendingToolCalls = new Map()

const exitWith = (code, reason) => {
  if (exited) return
  exited = true
  log('exit', { code, reason })
  rejectPendingToolCalls(`bridge exiting: ${reason}`)
  try { relayWs?.close() } catch { /* ignore */ }
  try { gateway?.close() } catch { /* ignore */ }
  void mcpServer?.close?.().catch(() => {})
  setTimeout(() => process.exit(code), 50).unref()
}

function sendRelay(msg) {
  if (!relayWs || relayWs.readyState !== relayWs.OPEN) {
    log('cannot send to relay — socket not open', { type: msg.type })
    return false
  }
  const enriched = { messageId: randomUUID(), sentAt: Date.now(), ...msg }
  relayWs.send(JSON.stringify(enriched))
  return true
}

function rejectPendingToolCalls(message) {
  for (const [callId, pending] of pendingToolCalls.entries()) {
    clearTimeout(pending.timer)
    pendingToolCalls.delete(callId)
    pending.resolve({
      ok: false,
      error: { code: 'relay_disconnected', message },
    })
  }
}

function resolvePendingToolResult(result) {
  const callId = typeof result?.callId === 'string' ? result.callId : ''
  if (!callId) return false
  const pending = pendingToolCalls.get(callId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingToolCalls.delete(callId)
  pending.resolve({
    ok: Boolean(result.ok),
    data: result.data,
    error: result.error,
  })
  return true
}

function proxyToolCallThroughRelay({ toolName, args, scope }) {
  if (!relayWs || relayWs.readyState !== relayWs.OPEN) {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'relay_not_connected',
        message: 'Oasis relay is not connected or paired yet.',
      },
    })
  }

  const callId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingToolCalls.delete(callId)
      resolve({
        ok: false,
        error: {
          code: 'tool_timeout',
          message: `Timed out waiting ${toolTimeoutMs}ms for browser tool result from "${toolName}".`,
        },
      })
    }, toolTimeoutMs)
    pendingToolCalls.set(callId, { resolve, timer, toolName })
    try {
      const sent = sendRelay({
        type: 'tool.call',
        callId,
        toolName,
        args: args || {},
        scope,
      })
      if (!sent) {
        throw new Error('relay socket not open')
      }
    } catch {
      clearTimeout(timer)
      pendingToolCalls.delete(callId)
      resolve({
        ok: false,
        error: {
          code: 'relay_send_failed',
          message: `Could not send Oasis tool "${toolName}" to the relay.`,
        },
      })
    }
  })
}

// Track Gateway runIds we issued from a given relay-side sessionId so we can
// route Gateway chat events back to the right browser chat session. The relay
// envelope's sessionId is opaque to us — we just echo it back on the result.
const runIdToRelaySessionId = new Map()

function setupGatewayChatBridge(creds) {
  if (skipGateway) {
    log('Gateway integration skipped (--no-gateway). chat.user envelopes will fall through to stdin echo.')
    return
  }

  // Subscribe to Gateway 'chat' events. They arrive whether or not we initiated
  // the run — filter by runId we know about.
  gateway.subscribeEvent('chat', (payload) => {
    const runId = typeof payload?.runId === 'string' ? payload.runId : ''
    const state = typeof payload?.state === 'string' ? payload.state : ''
    if (!runId) return
    const sessionId = runIdToRelaySessionId.get(runId)
    if (!sessionId) return  // not from a chat we initiated; ignore.

    const text = typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.delta === 'string'
        ? payload.delta
        : typeof payload?.content === 'string'
          ? payload.content
          : ''

    if (state === 'delta') {
      sendRelay({ type: 'chat.agent.delta', sessionId, text })
    } else if (state === 'final') {
      sendRelay({ type: 'chat.agent.final', sessionId, text })
      runIdToRelaySessionId.delete(runId)
    } else if (state === 'aborted' || state === 'error') {
      sendRelay({
        type: 'chat.agent.final',
        sessionId,
        text: text || `[OpenClaw chat ${state}]`,
      })
      runIdToRelaySessionId.delete(runId)
    }
  })
}

async function forwardChatUserToGateway(sessionId, text) {
  if (!gateway) {
    // Fallback: echo to stdout for legacy testing.
    console.log(`\n[user] ${text}`)
    console.log('[bridge] type a reply, then enter:')
    return
  }
  try {
    const idempotencyKey = randomUUID()
    // Use the relay sessionId as the Gateway sessionKey. OpenClaw stores chat
    // history per sessionKey, so the user gets a coherent conversation per
    // browser-chat-session.
    const result = await gateway.callMethod('chat.send', {
      sessionKey: sessionId || 'oasis-default',
      message: text,
      idempotencyKey,
    })
    const runId = result?.runId
    if (typeof runId === 'string' && runId) {
      runIdToRelaySessionId.set(runId, sessionId)
      log('chat.send →', { runId, sessionId })
    } else {
      log('chat.send returned no runId', result)
      sendRelay({
        type: 'chat.agent.final',
        sessionId,
        text: '[bridge] OpenClaw accepted the message but returned no runId',
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('chat.send failed:', message)
    sendRelay({
      type: 'chat.agent.final',
      sessionId,
      text: `[bridge] chat to OpenClaw failed: ${message}`,
    })
  }
}

async function start() {
  log('exchanging pairing code …')
  let creds
  try { creds = await exchangePairingCode() }
  catch (err) {
    log('exchange failed:', err?.message || String(err))
    exitWith(3, 'exchange_failed')
    return
  }
  log('paired:', {
    browserSessionId: creds.browserSessionId,
    worldId: creds.worldId,
    scopes: creds.scopes,
  })

  if (!skipMcp) {
    try {
      mcpServer = await startBridgeMcpServer({
        host: mcpHost,
        port: mcpPort,
        worldId: creds.worldId,
        agentType: 'openclaw',
        relayToolCall: proxyToolCallThroughRelay,
        logger: log,
      })
      log('OpenClaw Oasis MCP URL:', mcpServer.url)
      log('OpenClaw MCP config hint:', `openclaw mcp set oasis '{"url":"${mcpServer.url}","transport":"streamable-http"}'`)
    } catch (err) {
      log('MCP adapter failed to start; Oasis tools will not be available to OpenClaw:', err?.message || String(err))
      mcpServer = null
    }
  }

  // Connect to local OpenClaw Gateway in the background. Relay + Oasis tools
  // should come online even if Gateway auth is slow or temporarily unavailable;
  // chat.user will wait on ensureReady() when it actually needs Gateway.
  if (!skipGateway) {
    void (async () => {
      try {
        const identity = await loadOrCreateIdentity(identityPath)
        log('device identity:', { id: identity.id, path: identityPath })
        gateway = new GatewayClient({
          gatewayUrl: finalGatewayUrl,
          identity,
          sharedToken: gatewaySharedToken,
          logger: log,
        })
        setupGatewayChatBridge(creds)
        await gateway.ensureReady()
        log('Gateway ready')
      } catch (err) {
        log('Gateway connect failed (continuing without; chat.user will echo to stdout):', err?.message || String(err))
        gateway = null
      }
    })()
  }

  // Connect to the hosted relay.
  const explicitRelay = argv.flags['relay-url'] || process.env.OASIS_RELAY_URL || ''
  const relayUrl = explicitRelay || buildRelayUrl(finalOasisUrl)
  log('connecting to relay:', relayUrl)

  relayWs = new WebSocket(relayUrl, {
    headers: { authorization: `Bearer ${creds.deviceToken}` },
  })

  relayWs.on('open', () => log('relay socket open'))

  relayWs.on('message', (raw) => {
    let parsed
    try { parsed = JSON.parse(raw.toString()) }
    catch { log('non-JSON frame ignored'); return }

    if (parsed.type === 'relay.paired') {
      log('paired by relay:', { relaySessionId: parsed.relaySessionId })
      sendRelay({
        type: 'agent.hello',
        deviceToken: creds.deviceToken,
        agentLabel: labelOverride,
        agentVersion: '0.3.0-bridge-tools',
      })
      return
    }

    if (parsed.type === 'chat.user') {
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : 'oasis-default'
      const text = typeof parsed.text === 'string' ? parsed.text : ''
      void forwardChatUserToGateway(sessionId, text)
      return
    }

    if (parsed.type === 'tool.result') {
      if (!resolvePendingToolResult(parsed)) {
        log('tool.result received with no pending caller:', { callId: parsed.callId })
      }
      return
    }

    if (parsed.type === 'tool.call') {
      log('unexpected inbound tool.call on OpenClaw bridge:', { toolName: parsed.toolName, callId: parsed.callId })
      sendRelay({
        type: 'tool.result',
        callId: parsed.callId,
        ok: false,
        error: {
          code: 'bridge_wrong_direction',
          message: 'Oasis tools are requested by OpenClaw through the local bridge MCP adapter.',
        },
      })
      return
    }

    if (parsed.type === 'error') {
      log('relay error:', parsed)
      return
    }

    // chat.agent.* etc. arrive here too if multiple agents are paired; ignore.
  })

  relayWs.on('close', (code, reason) => {
    log('relay socket closed', { code, reason: reason?.toString?.() })
    if (!exited) exitWith(0, 'closed')
  })

  relayWs.on('error', (err) => {
    log('relay socket error:', err?.message || String(err))
    if (!exited) exitWith(5, 'socket_error')
  })

  // Stdin → chat.agent.final, useful when --no-gateway or as a manual override.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  rl.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    sendRelay({ type: 'chat.agent.final', sessionId: 'bridge-console', text })
  })
}

start().catch((err) => {
  log('fatal:', err?.message || String(err))
  exitWith(1, 'fatal')
})

process.on('SIGINT',  () => exitWith(0, 'SIGINT'))
process.on('SIGTERM', () => exitWith(0, 'SIGTERM'))
