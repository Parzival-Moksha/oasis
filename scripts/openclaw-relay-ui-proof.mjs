#!/usr/bin/env node
/**
 * Headed proof for the browser-executed OpenClaw relay path.
 *
 * It drives the real OpenClaw panel to enable the browser relay executor, then
 * starts the user-side bridge process on a throwaway MCP port and calls Oasis
 * tools through the bridge MCP server. This is intentionally close to the
 * click-path a human uses while still being deterministic enough for smoke.
 *
 * Env:
 *   OASIS_URL       default http://localhost:4516
 *   RELAY_URL       default local dev relay, or /relay for https OASIS_URL
 *   MCP_PORT        default 17904
 *   OPENCLAW_WORLD  optional world-name regex, default "openclaw 2"
 *   HEADLESS=1      run browser headless
 *   READ_ONLY=1     prove pairing + read tools only
 */

import { spawn } from 'node:child_process'
import http from 'node:http'

import { chromium } from 'playwright'

const OASIS = (process.env.OASIS_URL || 'http://localhost:4516').replace(/\/+$/, '')
const RELAY_URL = process.env.RELAY_URL || defaultRelayUrl(OASIS)
const MCP_PORT = Number(process.env.MCP_PORT || 17904)
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`
const WORLD_RE = new RegExp(process.env.OPENCLAW_WORLD || 'openclaw 2', 'i')
const HEADLESS = process.env.HEADLESS === '1'
const READ_ONLY = process.env.READ_ONLY === '1'
const LOG_PREFIX = '[openclaw-relay-ui-proof]'
const MCP_PROTOCOL_VERSION = '2025-06-18'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const log = (...args) => console.log(LOG_PREFIX, ...args)
let mcpSessionId = ''

function defaultRelayUrl(oasisUrl) {
  try {
    const parsed = new URL(oasisUrl)
    if (parsed.protocol === 'https:') return `wss://${parsed.host}/relay?role=agent`
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return `ws://${parsed.hostname}:4517/?role=agent`
    }
    return `ws://${parsed.host}/relay?role=agent`
  } catch {
    return 'ws://localhost:4517/?role=agent'
  }
}

function fail(message, extra) {
  const error = new Error(message)
  if (extra !== undefined) error.extra = extra
  throw error
}

function postJson(url, payload) {
  const body = JSON.stringify(payload)
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
    'content-length': Buffer.byteLength(body),
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
  }
  if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        const nextSessionId = res.headers['mcp-session-id']
        if (typeof nextSessionId === 'string' && nextSessionId) mcpSessionId = nextSessionId
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          return
        }
        resolve(data)
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function mcpRpc(method, params = {}, id = Math.floor(Math.random() * 1e9)) {
  const raw = await postJson(MCP_URL, { jsonrpc: '2.0', id, method, params })
  const eventLine = raw.split(/\r?\n/).find(line => line.startsWith('data: '))
  const jsonText = eventLine ? eventLine.slice(6) : raw
  const parsed = JSON.parse(jsonText)
  if (parsed.error) fail(`MCP ${method} error`, parsed.error)
  return parsed.result
}

async function callTool(name, args = {}) {
  const result = await mcpRpc('tools/call', { name, arguments: args })
  if (result.isError) fail(`tool ${name} returned isError`, result)
  const text = result.content?.find(item => item.type === 'text')?.text || ''
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text, result }
  }
}

async function chooseWorld(page) {
  let activeWorld = null
  const activeResponse = await page.request.get(`${OASIS}/api/world-active`).catch(() => null)
  if (activeResponse?.ok()) {
    const active = await activeResponse.json().catch(() => null)
    if (active?.ok && typeof active.worldId === 'string') {
      activeWorld = { id: active.worldId, name: active.source || 'active world' }
    }
  }

  const worldsResponse = await page.request.get(`${OASIS}/api/worlds`)
  if (!worldsResponse.ok()) {
    if (activeWorld) return activeWorld
    fail(`worlds HTTP ${worldsResponse.status()}`, await worldsResponse.text())
  }
  const worlds = await worldsResponse.json()
  const preferred = worlds.find(w => WORLD_RE.test(w.name || ''))
    || worlds.find(w => /openclaw/i.test(w.name || ''))
    || activeWorld
    || worlds[0]
  if (!preferred) fail('no worlds available')
  return preferred
}

async function startBrowserRelay(page) {
  const configTab = page.getByRole('button', { name: /^config$/i })
  if (!await configTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'OpenClaw', exact: true }).click({ timeout: 15_000 })
  }
  if (await configTab.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await configTab.click()
  }

  const startRelayButton = page.getByRole('button', { name: /start relay/i })
  if (await startRelayButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await startRelayButton.click()
    log('clicked Start Relay in the OpenClaw panel')
  } else {
    log('Start Relay button not visible; assuming relay is already enabled')
  }
}

async function mintPairing(page, worldId) {
  const pairingResponse = await page.request.post(`${OASIS}/api/relay/pairings`, {
    data: {
      worldId,
      scopes: ['world.read', 'world.write.safe', 'screenshot.request', 'chat.stream'],
    },
  })
  if (!pairingResponse.ok()) fail(`pairing HTTP ${pairingResponse.status()}`, await pairingResponse.text())
  const pairing = await pairingResponse.json()
  if (!pairing?.ok) fail('pairing failed', pairing)
  return pairing
}

async function startBridge(pairingCode) {
  const args = [
    'scripts/openclaw-oasis-bridge.mjs',
    `${OASIS}/pair/${pairingCode}`,
    `--relay-url=${RELAY_URL}`,
    `--mcp-port=${MCP_PORT}`,
  ]
  const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let bridgeLog = ''
  child.stdout.on('data', chunk => {
    const text = chunk.toString()
    bridgeLog += text
    process.stdout.write(text)
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    bridgeLog += text
    process.stderr.write(text)
  })

  const started = Date.now()
  while (!bridgeLog.includes(`OpenClaw Oasis MCP URL: ${MCP_URL}`) || !bridgeLog.includes('paired by relay')) {
    if (Date.now() - started > 45_000) fail('bridge did not expose MCP and pair in time', bridgeLog)
    if (child.exitCode !== null) fail(`bridge exited ${child.exitCode}`, bridgeLog)
    await wait(250)
  }
  return child
}

async function pickAsset() {
  for (const query of ['cube', 'crate', 'rock', 'chair', 'tree']) {
    const search = await callTool('search_assets', { query, limit: 5 })
    const first = Array.isArray(search.data) ? search.data[0] : search.data?.results?.[0]
    if (first?.id || first?.catalogId) {
      return {
        id: first.id || first.catalogId,
        label: first.name || first.label || query,
      }
    }
  }

  const catalog = await callTool('get_asset_catalog', {})
  const byCategory = catalog.data || {}
  for (const entries of Object.values(byCategory)) {
    if (Array.isArray(entries) && entries[0]?.id) {
      return { id: entries[0].id, label: entries[0].name || entries[0].id }
    }
  }
  fail('could not find placeable asset')
}

async function proveMcpRoundTrip() {
  await mcpRpc('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'openclaw-relay-ui-proof', version: '1.0.0' },
  }, 1)

  const listed = await mcpRpc('tools/list', {}, 2)
  const toolNames = (listed.tools || []).map(tool => tool.name)
  for (const required of ['get_world_info', 'search_assets', 'place_object', 'query_objects']) {
    if (!toolNames.includes(required)) fail(`missing tool ${required}`, toolNames)
  }
  log('tools listed', toolNames.length)

  const info = await callTool('get_world_info', {})
  if (!info.ok) fail('get_world_info not ok', info)
  log('world info', JSON.stringify(info.data))

  if (READ_ONLY) {
    log('READ_ONLY=1; skipping place_object/query_objects mutation proof')
    return
  }

  const asset = await pickAsset()
  const label = `relay smoke ${new Date().toISOString().replace(/[:.]/g, '-')}`
  log('placing asset', asset.id, asset.label)
  const placed = await callTool('place_object', {
    catalogId: asset.id,
    position: [2.25, 0, 1.25],
    rotation: [0, 0, 0],
    scale: 0.35,
    label,
  })
  if (!placed.ok) fail('place_object not ok', placed)
  const objectId = placed.data?.id || ''
  log('placed object', objectId || JSON.stringify(placed.data))

  const queried = await callTool('query_objects', { query: label, limit: 5 })
  const queryText = JSON.stringify(queried)
  if (!queryText.includes(label) && objectId && !queryText.includes(objectId)) {
    fail('query_objects did not find placed smoke object', queried)
  }
  log('query confirmed placed object')
}

let browser
let bridge

try {
  browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 80 })
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await context.newPage()

  page.on('console', msg => {
    const type = msg.type()
    if (type === 'error' || type === 'warning') {
      console.log('[browser console]', type, msg.text().slice(0, 500))
    }
  })

  log('initializing Oasis session')
  const session = await page.request.get(`${OASIS}/api/session/init`)
  if (!session.ok()) fail(`session init HTTP ${session.status()}`, await session.text())

  const world = await chooseWorld(page)
  log('using world', `${world.name} (${world.id})`)
  await context.addInitScript((worldId) => {
    window.localStorage.setItem('oasis-active-world', worldId)
  }, world.id)
  const activeResponse = await page.request.post(`${OASIS}/api/world-active`, { data: { worldId: world.id } })
  if (!activeResponse.ok()) fail(`world-active HTTP ${activeResponse.status()}`, await activeResponse.text())

  await page.goto(OASIS, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(2_500)
  await startBrowserRelay(page)
  await page.waitForTimeout(2_000)

  const pairing = await mintPairing(page, world.id)
  log('minted pairing', pairing.code, 'world', pairing.worldId)
  bridge = await startBridge(pairing.code)
  log('bridge MCP + relay paired')

  await proveMcpRoundTrip()
  await page.bringToFront()
  await page.waitForTimeout(2_000)
  log(`PASS headed UI relay MCP ${READ_ONLY ? 'read-only' : 'read/write'} proof`)
} catch (error) {
  console.error(LOG_PREFIX, 'FAIL', error?.message || String(error))
  if (error?.extra) console.error(error.extra)
  process.exitCode = 1
} finally {
  if (bridge && bridge.exitCode === null) bridge.kill('SIGTERM')
  await wait(500)
  if (browser) await browser.close()
}
