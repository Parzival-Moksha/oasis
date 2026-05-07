#!/usr/bin/env node
/**
 * scripts/hermes-oasis-bridge.mjs
 *
 * Hermes bridge for hosted/local Oasis relay pairing.
 *
 * Runs beside Hermes, where Hermes API server is reachable on loopback. The
 * bridge connects outbound to Oasis relay, receives chat.user frames, calls
 * Hermes's OpenAI-compatible API server, and streams chat.agent.* frames back.
 * It also starts a local Streamable HTTP MCP adapter so Hermes can call Oasis
 * tools; the adapter proxies tool.call frames through the relay and waits for
 * browser-executed tool.result frames.
 *
 * Run:
 *   node scripts/hermes-oasis-bridge.mjs https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX
 *
 * Env / flags:
 *   --api-base=...       HERMES_API_BASE default http://127.0.0.1:8642/v1
 *   --api-key=...        HERMES_API_KEY or API_SERVER_KEY
 *   --model=...          HERMES_MODEL optional
 *   --system-prompt=...  HERMES_SYSTEM_PROMPT optional
 *   --relay-url=...      OASIS_RELAY_URL optional override for local dev
 *   --label=...          OASIS_AGENT_LABEL default hermes-bridge
 *   --mcp-port=...       HERMES_OASIS_MCP_PORT default 17891
 *   --mcp-host=...       HERMES_OASIS_MCP_HOST default 127.0.0.1
 *   --mcp-config=auto|preserve  HERMES_OASIS_MCP_CONFIG default auto
 *   --no-mcp             skip local Oasis MCP adapter
 *   --no-mcp-config      leave ~/.hermes/config.yaml unchanged
 *   --restore-mcp        restore the previous Hermes MCP config snapshot
 *   --echo               skip Hermes API and echo replies for smoke testing
 */

import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

import { startBridgeMcpServer } from './openclaw-bridge-mcp.mjs'
import {
  HERMES_OASIS_MCP_TOOL_INCLUDE,
  installHermesMcpConfig,
  resolveDefaultHermesConfigPath,
  resolveDefaultHermesStatePath,
  restoreHermesMcpConfig,
} from './hermes-mcp-config-guard.mjs'

const DEFAULT_HERMES_API_BASE = 'http://127.0.0.1:8642/v1'
const BRIDGE_VERSION = '0.2.1-hermes-responses'

function parseArgv(argv) {
  const out = { positional: [], flags: {} }
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      out.positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    if (eq >= 0) out.flags[arg.slice(2, eq)] = arg.slice(eq + 1)
    else out.flags[arg.slice(2)] = 'true'
  }
  return out
}

const bridgeArgv = Array.isArray(globalThis.__HermesOasisBridgeArgv)
  ? globalThis.__HermesOasisBridgeArgv
  : process.argv.slice(2)
const argv = parseArgv(bridgeArgv)
const rawPairing = argv.positional[0] || process.env.OASIS_PAIRING_URL || ''
const oasisUrlOverride = argv.flags['oasis-url'] || process.env.OASIS_URL || ''
const explicitRelayUrl = argv.flags['relay-url'] || process.env.OASIS_RELAY_URL || ''
const label = argv.flags.label || process.env.OASIS_AGENT_LABEL || 'hermes-bridge'
const agentType = argv.flags['agent-type'] || process.env.OASIS_AGENT_TYPE || 'hermes'
const agentSlot = argv.flags['agent-slot'] || process.env.OASIS_AGENT_SLOT || 'hermes:primary'
const apiBase = normalizeApiBase(argv.flags['api-base'] || process.env.HERMES_API_BASE || DEFAULT_HERMES_API_BASE)
const apiKey = argv.flags['api-key'] || process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || loadHermesEnvValue(['HERMES_API_KEY', 'API_SERVER_KEY'])
const model = argv.flags.model || process.env.HERMES_MODEL || ''
const systemPrompt = argv.flags['system-prompt'] || process.env.HERMES_SYSTEM_PROMPT || ''
const echoMode = argv.flags.echo === 'true' || process.env.HERMES_BRIDGE_ECHO === '1'
const apiMode = normalizeApiMode(argv.flags['api-mode'] || process.env.HERMES_API_MODE || 'responses')
const skipMcp = argv.flags['no-mcp'] === 'true' || process.env.HERMES_OASIS_NO_MCP === '1'
const mcpHost = argv.flags['mcp-host'] || process.env.HERMES_OASIS_MCP_HOST || '127.0.0.1'
const mcpPort = Number(argv.flags['mcp-port'] || process.env.HERMES_OASIS_MCP_PORT || 17891)
const toolTimeoutMs = Number(argv.flags['tool-timeout-ms'] || process.env.HERMES_OASIS_TOOL_TIMEOUT_MS || 30_000)
const mcpConfigMode = argv.flags['no-mcp-config'] === 'true'
  ? 'preserve'
  : (argv.flags['mcp-config'] || process.env.HERMES_OASIS_MCP_CONFIG || 'auto').toLowerCase()
const mcpServerName = argv.flags['mcp-server-name'] || process.env.HERMES_OASIS_MCP_SERVER_NAME || 'oasis'
const hermesConfigPath = argv.flags['hermes-config'] || process.env.HERMES_CONFIG_PATH || resolveDefaultHermesConfigPath()
const mcpRestoreStatePath = argv.flags['mcp-restore-state'] || process.env.HERMES_OASIS_MCP_RESTORE_STATE || ''

const log = (...args) => console.log('[hermes-bridge]', ...args)

function resolvedMcpRestoreStatePath() {
  return mcpRestoreStatePath || resolveDefaultHermesStatePath(os.homedir(), mcpServerName)
}

if (argv.flags['restore-mcp'] === 'true') {
  try {
    await restoreHermesMcpConfig({
      statePath: resolvedMcpRestoreStatePath(),
      logger: log,
    })
    process.exit(0)
  } catch (err) {
    log('restore MCP config failed:', err?.message || String(err))
    process.exit(1)
  }
}

if (!rawPairing) {
  console.error('usage: node scripts/hermes-oasis-bridge.mjs <pairing-url-or-code>')
  console.error('  optional: --api-base=http://127.0.0.1:8642/v1 --api-key=... --model=...')
  console.error('  optional: --relay-url=ws://localhost:4517/?role=agent --api-mode=responses|chat --mcp-port=17891 --echo')
  console.error('  optional: --no-mcp --no-mcp-config --restore-mcp')
  process.exit(2)
}

function normalizeApiMode(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'chat' || raw === 'chat-completions' || raw === 'chat_completions') return 'chat'
  return 'responses'
}

function normalizeApiBase(value) {
  return String(value || DEFAULT_HERMES_API_BASE).trim().replace(/\/+$/, '')
}

function loadHermesEnvValue(names) {
  const envPath = path.join(os.homedir(), '.hermes', '.env')
  let raw = ''
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return ''
  }
  const wanted = new Set(names)
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!wanted.has(key)) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    return value
  }
  return ''
}

function parsePairing(input) {
  const trimmed = input.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/(?:pair|p)\/([^/]+)/)
    return {
      code: match ? decodeURIComponent(match[1]) : '',
      oasisUrl: `${url.protocol}//${url.host}`,
    }
  }
  return { code: trimmed, oasisUrl: oasisUrlOverride || 'http://localhost:4516' }
}

const parsedPairing = parsePairing(rawPairing)
const pairingCode = parsedPairing.code
const oasisUrl = oasisUrlOverride || parsedPairing.oasisUrl

if (!pairingCode || !pairingCode.startsWith('OASIS-')) {
  console.error('[hermes-bridge] could not extract a valid OASIS-XXXXXXXX code from input:', rawPairing)
  process.exit(2)
}

function withRelayIdentity(url, slot = agentSlot, type = agentType) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('agentType', type)
    parsed.searchParams.set('agentSlot', slot)
    return parsed.toString()
  } catch {
    return url
  }
}

function buildRelayUrl(httpUrl) {
  const base = httpUrl.replace(/\/+$/, '')
  if (base.startsWith('https://')) return withRelayIdentity(`wss://${base.slice('https://'.length)}/relay?role=agent`)
  if (base.startsWith('http://')) return withRelayIdentity(`ws://${base.slice('http://'.length)}/relay?role=agent`)
  return withRelayIdentity(`ws://${base}/relay?role=agent`)
}

function rootBaseFromApiBase(base) {
  return base.replace(/\/v1$/i, '')
}

function authHeaders() {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
}

function jsonHeaders() {
  return {
    ...authHeaders(),
    'content-type': 'application/json',
  }
}

async function exchangePairingCode() {
  const url = `${oasisUrl.replace(/\/+$/, '')}/api/relay/devices/exchange`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingCode,
      agentLabel: label,
      agentType,
      agentSlot,
      agentVersion: BRIDGE_VERSION,
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
    agentType: json.agentType || agentType,
    agentSlot: json.agentSlot || agentSlot,
  }
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text().catch(() => '')
  return { response, text }
}

async function checkHermesApi() {
  if (echoMode) {
    log('Hermes API check skipped (--echo).')
    return { models: [] }
  }

  const healthUrl = `${rootBaseFromApiBase(apiBase)}/health`
  const modelsUrl = `${apiBase}/models`
  const [health, modelsResponse] = await Promise.allSettled([
    fetchText(healthUrl, { headers: authHeaders() }),
    fetchText(modelsUrl, { headers: authHeaders() }),
  ])

  const healthOk = health.status === 'fulfilled' && health.value.response.ok
  const modelsOk = modelsResponse.status === 'fulfilled' && modelsResponse.value.response.ok
  if (!healthOk && !modelsOk) {
    const healthDetail = health.status === 'fulfilled'
      ? `HTTP ${health.value.response.status} ${health.value.text.slice(0, 160)}`
      : health.reason?.message || String(health.reason)
    const modelsDetail = modelsResponse.status === 'fulfilled'
      ? `HTTP ${modelsResponse.value.response.status} ${modelsResponse.value.text.slice(0, 160)}`
      : modelsResponse.reason?.message || String(modelsResponse.reason)
    throw new Error(
      `Hermes API is not reachable at ${apiBase}. ` +
      `Health: ${healthDetail}. Models: ${modelsDetail}. ` +
      'Start Hermes gateway so 127.0.0.1:8642 is listening, or pass --api-base/--api-key.'
    )
  }

  let models = []
  if (modelsOk) {
    try {
      const parsed = JSON.parse(modelsResponse.value.text)
      models = Array.isArray(parsed?.data)
        ? parsed.data.map(entry => typeof entry?.id === 'string' ? entry.id : '').filter(Boolean)
        : []
    } catch {
      models = []
    }
  }

  log('Hermes API reachable:', {
    apiBase,
    health: healthOk ? 'ok' : 'unavailable',
    models: models.length ? models.slice(0, 5) : '(none listed)',
  })
  return { models }
}

function buildChatMessages(userText) {
  const messages = []
  const instructions = buildHermesInstructions()
  if (instructions) {
    messages.push({ role: 'system', content: instructions })
  }
  messages.push({ role: 'user', content: userText })
  return messages
}

function buildHermesInstructions() {
  if (systemPrompt.trim()) return systemPrompt.trim()
  const displayName = String(label || 'Hermes').trim() || 'Hermes'
  const worldLine = activeWorldId
    ? `Current Oasis worldId: ${activeWorldId}. Use get_world_info or get_world_state when you need the live world name, objects, sky, ground, lights, or screenshot context.`
    : 'Use the Oasis world tools to discover the live world before making broad assumptions about it.'
  return [
    `You are ${displayName}, a Hermes Agent connected to Oasis as an embodied world agent.`,
    'When the user asks who you are, use that name unless your own configured Hermes profile strongly says otherwise.',
    worldLine,
    'You can inspect the Oasis world and use the installed Oasis MCP tools when available. Be concise, world-aware, and honest about what you can see or change.',
  ].join(' ')
}

function hermesConversationId(sessionId) {
  const cleanSlot = String(agentSlot || 'hermes-primary')
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44) || 'hermes-primary'
  const cleanSession = String(sessionId || 'hermes-default')
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 76) || 'hermes-default'
  return `oasis-${cleanSlot}-${cleanSession}`.slice(0, 128)
}

function extractText(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    if (typeof part.text === 'string') return part.text
    if (typeof part.content === 'string') return part.content
    return ''
  }).join('')
}

function extractSsePayloads(buffer) {
  const normalized = buffer.replace(/\r/g, '')
  const blocks = normalized.split('\n\n')
  const remainder = blocks.pop() ?? ''
  const payloads = []
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (data) payloads.push(data)
  }
  return { payloads, remainder }
}

async function callHermes(sessionId, userText, onDelta) {
  if (echoMode) {
    const reply = `Hermes bridge echo: ${userText}`
    await delay(80)
    onDelta(reply)
    return reply
  }

  if (apiMode === 'chat') {
    return callHermesChat(userText, onDelta)
  }
  return callHermesResponses(sessionId, userText, onDelta)
}

async function callHermesChat(userText, onDelta) {
  const body = {
    model: model || 'hermes',
    stream: true,
    stream_options: { include_usage: true },
    messages: buildChatMessages(userText),
  }

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Hermes API returned HTTP ${response.status}: ${detail.slice(0, 600)}`)
  }
  if (!response.body) {
    throw new Error('Hermes API returned no response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assistantText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const extracted = extractSsePayloads(buffer)
    buffer = extracted.remainder

    for (const payload of extracted.payloads) {
      if (payload === '[DONE]') continue
      let parsed
      try { parsed = JSON.parse(payload) }
      catch { continue }
      if (parsed?.error) {
        const message = typeof parsed.error?.message === 'string' ? parsed.error.message : 'Hermes stream error.'
        throw new Error(message)
      }
      const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined
      const delta = choice?.delta || {}
      const text = extractText(delta.content)
      if (text) {
        assistantText += text
        onDelta(text)
      }
    }
  }

  return assistantText
}

function extractResponsesOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text
  if (!Array.isArray(response?.output)) return ''
  return response.output.map(item => {
    if (!item || typeof item !== 'object') return ''
    if (item.type === 'message') return extractText(item.content)
    if (item.type === 'output_text') return extractText(item.text ?? item.content)
    return ''
  }).join('')
}

function extractResponsesDelta(event) {
  if (!event || typeof event !== 'object') return ''
  if (event.type === 'response.output_text.delta') {
    return extractText(event.delta ?? event.text ?? event.content)
  }
  if (event.type === 'response.completed') {
    return extractResponsesOutputText(event.response)
  }
  return ''
}

async function callHermesResponses(sessionId, userText, onDelta) {
  const body = {
    model: model || 'hermes',
    input: userText,
    conversation: hermesConversationId(sessionId),
    store: true,
    stream: true,
    ...(() => {
      const instructions = buildHermesInstructions()
      return instructions ? { instructions } : {}
    })(),
  }

  const response = await fetch(`${apiBase}/responses`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const hint = response.status === 404
      ? ' Hermes /v1/responses is unavailable; update Hermes Agent or run with --api-mode=chat for a stateless fallback.'
      : ''
    throw new Error(`Hermes Responses API returned HTTP ${response.status}: ${detail.slice(0, 600)}${hint}`)
  }
  if (!response.body) {
    throw new Error('Hermes Responses API returned no response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assistantText = ''
  let completedText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const extracted = extractSsePayloads(buffer)
    buffer = extracted.remainder

    for (const payload of extracted.payloads) {
      if (payload === '[DONE]') continue
      let parsed
      try { parsed = JSON.parse(payload) }
      catch { continue }
      if (parsed?.error) {
        const message = typeof parsed.error?.message === 'string' ? parsed.error.message : 'Hermes stream error.'
        throw new Error(message)
      }
      const text = extractResponsesDelta(parsed)
      if (!text) continue
      if (parsed.type === 'response.completed') {
        completedText = text
        continue
      }
      assistantText += text
      onDelta(text)
    }
  }

  if (!assistantText && completedText) {
    assistantText = completedText
    onDelta(completedText)
  }
  return assistantText
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let relayWs = null
let exited = false
let relaySessionId = ''
let activeWorldId = ''
let mcpServer = null
const pendingToolCalls = new Map()
const mcpDiagnostics = {
  requestCount: 0,
  toolCallCount: 0,
  lastRequestAt: 0,
  lastToolCallAt: 0,
  lastToolName: '',
  lastToolWorldId: '',
}

function sendRelay(msg) {
  if (!relayWs || relayWs.readyState !== relayWs.OPEN) {
    log('cannot send to relay: socket not open', { type: msg.type })
    return false
  }
  relayWs.send(JSON.stringify({
    messageId: randomUUID(),
    sentAt: Date.now(),
    ...(relaySessionId ? { relaySessionId } : {}),
    ...msg,
  }))
  return true
}

function updateActiveWorldId(nextWorldId, source = 'relay') {
  const trimmed = typeof nextWorldId === 'string' ? nextWorldId.trim() : ''
  if (!trimmed || trimmed === activeWorldId) return
  const previousWorldId = activeWorldId || '(none)'
  activeWorldId = trimmed
  log('active Oasis world updated', { source, previousWorldId, worldId: activeWorldId })
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
  log('tool.result <- relay', {
    toolName: pending.toolName,
    worldId: pending.worldId || '(none)',
    ok: Boolean(result.ok),
  })
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
    pendingToolCalls.set(callId, { resolve, timer, toolName, worldId: args?.worldId || '' })
    try {
      log('tool.call -> relay', { toolName, scope, callId, worldId: args?.worldId || '(none)' })
      const sent = sendRelay({
        type: 'tool.call',
        callId,
        toolName,
        args: args || {},
        scope,
      })
      if (!sent) throw new Error('relay socket not open')
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

function exitWith(code, reason) {
  if (exited) return
  exited = true
  log('exit', { code, reason })
  rejectPendingToolCalls(`bridge exiting: ${reason}`)
  try { relayWs?.close() } catch { /* ignore */ }
  const emergencyExit = setTimeout(() => process.exit(code), 4_000)
  emergencyExit.unref()
  Promise.allSettled([
    mcpServer?.close?.(),
  ]).finally(() => {
    clearTimeout(emergencyExit)
    process.exit(code)
  })
}

async function forwardChatUser(sessionId, text) {
  const safeSessionId = sessionId || 'hermes-default'
  try {
    log('chat.user <- relay', { sessionId: safeSessionId, chars: text.length })
    let sentAnyDelta = false
    const finalText = await callHermes(safeSessionId, text, chunk => {
      sentAnyDelta = true
      sendRelay({ type: 'chat.agent.delta', sessionId: safeSessionId, text: chunk })
    })
    sendRelay({
      type: 'chat.agent.final',
      sessionId: safeSessionId,
      text: finalText || (sentAnyDelta ? '' : '[hermes-bridge] Hermes returned no text.'),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('Hermes chat failed:', message)
    sendRelay({
      type: 'chat.agent.final',
      sessionId: safeSessionId,
      text: `[hermes-bridge] Hermes request failed: ${message}`,
    })
  }
}

async function start() {
  log('config:', {
    oasisUrl,
    pairingCode,
    label,
    agentType,
    agentSlot,
    apiBase: echoMode ? '(echo)' : apiBase,
    apiMode: echoMode ? 'echo' : apiMode,
    model: model || '(default)',
    relay: explicitRelayUrl || '(from Oasis URL)',
  })

  await checkHermesApi()

  log('exchanging pairing code...')
  const creds = await exchangePairingCode()
  log('paired with browser session:', {
    browserSessionId: creds.browserSessionId,
    worldId: creds.worldId,
    agentType: creds.agentType || agentType,
    agentSlot: creds.agentSlot || agentSlot,
    scopes: creds.scopes,
  })
  activeWorldId = creds.worldId

  if (!skipMcp) {
    try {
      mcpServer = await startBridgeMcpServer({
        host: mcpHost,
        port: mcpPort,
        worldId: creds.worldId,
        getWorldId: () => activeWorldId || creds.worldId,
        agentType,
        relayToolCall: proxyToolCallThroughRelay,
        logger: log,
        onRequest: ({ method, sessionId, initialize }) => {
          mcpDiagnostics.requestCount += 1
          mcpDiagnostics.lastRequestAt = Date.now()
          log('MCP adapter hit', {
            count: mcpDiagnostics.requestCount,
            method,
            sessionId: sessionId || '(new)',
            initialize,
          })
        },
        onToolCall: ({ toolName, worldId }) => {
          mcpDiagnostics.toolCallCount += 1
          mcpDiagnostics.lastToolCallAt = Date.now()
          mcpDiagnostics.lastToolName = toolName
          mcpDiagnostics.lastToolWorldId = worldId
          log('MCP tool invoked', {
            count: mcpDiagnostics.toolCallCount,
            toolName,
            worldId: worldId || '(none)',
          })
        },
      })
      log('Hermes Oasis MCP URL:', mcpServer.url)
      log('Hermes MCP config hint:', [
        'mcp_servers:',
        `  ${mcpServerName}:`,
        `    url: "${mcpServer.url}"`,
        '    enabled: true',
        '    tools:',
        '      prompts: false',
        '      resources: false',
      ].join('\\n'))
      if (mcpConfigMode === 'auto') {
        try {
          const installed = await installHermesMcpConfig({
            configPath: hermesConfigPath,
            statePath: resolvedMcpRestoreStatePath(),
            serverName: mcpServerName,
            url: mcpServer.url,
            tools: HERMES_OASIS_MCP_TOOL_INCLUDE,
            logger: log,
          })
          if (installed?.changed) {
            log('Run /reload-mcp in Hermes chat, or restart the Hermes gateway/dashboard so it discovers Oasis tools.')
          }
        } catch (err) {
          log('Hermes MCP config auto-switch failed; use the config hint above:', err?.message || String(err))
        }
      } else if (mcpConfigMode === 'preserve' || mcpConfigMode === 'off') {
        log(`Hermes MCP config left unchanged (--mcp-config=${mcpConfigMode}).`)
      } else {
        log(`Unknown --mcp-config=${mcpConfigMode}; leaving Hermes MCP config unchanged.`)
      }
    } catch (err) {
      log('MCP adapter failed to start; Oasis tools will not be available to Hermes:', err?.message || String(err))
      mcpServer = null
    }
  } else {
    log('Hermes Oasis MCP adapter skipped (--no-mcp).')
  }

  const relayUrl = explicitRelayUrl ? withRelayIdentity(explicitRelayUrl) : buildRelayUrl(oasisUrl)
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
      relaySessionId = typeof parsed.relaySessionId === 'string' ? parsed.relaySessionId : ''
      log('paired by relay:', { relaySessionId })
      sendRelay({
        type: 'agent.hello',
        deviceToken: creds.deviceToken,
        agentLabel: label,
        agentType,
        agentSlot,
        agentVersion: BRIDGE_VERSION,
      })
      sendRelay({
        type: 'agent.status',
        agentType,
        agentSlot,
        localApi: { url: apiBase, ok: true },
        mcp: {
          url: mcpServer?.url || `http://${mcpHost}:${mcpPort}/mcp`,
          ok: Boolean(mcpServer),
          configured: mcpConfigMode === 'auto',
        },
        model: model || undefined,
        capabilities: ['chat.stream', 'world.read', 'world.write.safe', 'screenshot.request'],
      })
      return
    }

    if (parsed.type === 'browser.hello' || parsed.type === 'browser.ready') {
      updateActiveWorldId(parsed.worldId || creds.worldId, parsed.type)
      log(`${parsed.type} <- relay`, {
        worldId: parsed.worldId || creds.worldId,
        tools: Array.isArray(parsed.availableTools) ? parsed.availableTools.length : undefined,
      })
      return
    }

    if (parsed.type === 'chat.user') {
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : 'hermes-default'
      const text = typeof parsed.text === 'string' ? parsed.text : ''
      if (text.trim()) void forwardChatUser(sessionId, text)
      return
    }

    if (parsed.type === 'tool.result') {
      if (!resolvePendingToolResult(parsed)) {
        log('tool.result received with no pending caller:', { callId: parsed.callId })
      }
      return
    }

    if (parsed.type === 'tool.call') {
      log('unexpected inbound tool.call on Hermes bridge', { toolName: parsed.toolName, callId: parsed.callId })
      sendRelay({
        type: 'tool.result',
        callId: parsed.callId || 'unknown',
        ok: false,
        error: {
          code: 'bridge_wrong_direction',
          message: 'Oasis tools are requested by Hermes through the local bridge MCP adapter.',
        },
      })
      return
    }

    if (parsed.type === 'error') {
      log('relay error:', parsed)
    }
  })

  relayWs.on('close', (code, reason) => {
    log('relay socket closed', { code, reason: reason?.toString?.() })
    if (!exited) exitWith(0, 'closed')
  })

  relayWs.on('error', (err) => {
    log('relay socket error:', err?.message || String(err))
    if (!exited) exitWith(5, 'socket_error')
  })

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  rl.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    sendRelay({ type: 'chat.agent.final', sessionId: 'bridge-console', text })
  })
}

process.on('SIGINT', () => exitWith(130, 'SIGINT'))
process.on('SIGTERM', () => exitWith(143, 'SIGTERM'))

start().catch((err) => {
  log('fatal:', err?.message || String(err))
  exitWith(1, 'fatal')
})
