#!/usr/bin/env node
// The Oasis world tools, as a local MCP server inside the plugin (stdio).
//
// Claude Code starts this file (`node ${CLAUDE_PLUGIN_ROOT}/mcp/oasis-mcp.mjs`) and talks to it over
// stdin/stdout. It has no tools of its own: it passes each request on to the Oasis running on this
// machine (http://127.0.0.1:4516/api/mcp/oasis) and hands the answer back. Nothing leaves the machine.
//
//   - The Oasis is not running: the tool list is empty, and it fills by itself once the Oasis is up
//     (a `tools/list_changed` notification), so a session opened before /oasis gets the tools later.
//   - Every tool the local Oasis has is offered, the ones that generate pictures, video, music, speech or 3D
//     models included: each of those works with the user's own key in the Oasis and says so when it is missing.
//     OASIS_PLUGIN_NO_GENERATION=1 leaves them out (EXCLUDED below).
//   - Each tool gets a title and read-only / destructive hints when the Oasis did not send them.
//
// No dependencies: Node 18 or later (global fetch).
//   OASIS_WEB_URL     where the Oasis page server is (default http://127.0.0.1:4516; loopback only)
//   OASIS_TOKEN_FILE  the local token file (default ~/.oasis/token), sent as a Bearer token when it exists
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const NAME = 'oasis'
const VERSION = '0.5.0'
const DEFAULT_WEB = 'http://127.0.0.1:4516'
const RETRY_MS = 5000
const CALL_TIMEOUT_MS = 10 * 60 * 1000
const PROTOCOL = '2025-06-18'

/** Only ever a loopback address: this server must not become a way to reach other machines. */
export function webUrl(value = process.env.OASIS_WEB_URL) {
  try {
    const url = new URL((value || DEFAULT_WEB).trim())
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (url.protocol === 'http:' && (host === '127.0.0.1' || host === 'localhost' || host === '::1')) return url.origin
  } catch {
    // fall through to the default
  }
  return DEFAULT_WEB
}

/** The tools that generate with AI services; left out only with OASIS_PLUGIN_NO_GENERATION=1. */
export const EXCLUDED = new Set([
  'generate_image', 'generate_video', 'generate_voice',
  'text_to_pic', 'text_to_pic_building', 'text_to_video', 'text_to_music',
  'conjure_framed_picture', 'avatarpic_merlin', 'avatarpic_user',
  'conjure_asset', 'process_conjured_asset',
])
export const isGeneration = (name) => EXCLUDED.has(name) || /^(generate|text_to)_/.test(name)
export const isExcluded = (name, env = process.env) => env.OASIS_PLUGIN_NO_GENERATION === '1' && isGeneration(name)

const READ_ONLY = /^(get|list|query|search|screenshot)_/
const DESTRUCTIVE = /^(remove|delete|clear)_|^load_world$/

/** "place_object" -> "Place object" */
const titleOf = (name) => name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function annotate(tool) {
  const given = tool.annotations || {}
  const readOnly = given.readOnlyHint ?? READ_ONLY.test(tool.name)
  // A title that only repeats the tool's name is no title.
  const said = [tool.title, given.title].find((t) => t && t !== tool.name)
  const title = said || titleOf(tool.name)
  return {
    ...tool,
    title,
    annotations: {
      openWorldHint: false,
      ...given,
      title,
      readOnlyHint: readOnly,
      destructiveHint: given.destructiveHint ?? (!readOnly && DESTRUCTIVE.test(tool.name)),
    },
  }
}

export const offered = (tools) => (tools || []).filter((t) => t?.name && !isExcluded(t.name)).map(annotate)

function token() {
  const file = process.env.OASIS_TOKEN_FILE || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'token')
  try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' }
}

/** One JSON-RPC answer out of a streamable-HTTP reply (plain JSON, or an event stream). */
export function parseReply(contentType, text, id) {
  if (!String(contentType).includes('text/event-stream')) return text.trim() ? JSON.parse(text) : null
  let last = null
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
    if (!data) continue
    try {
      const message = JSON.parse(data)
      if (message && message.id === id) return message
      last = message
    } catch {
      // not JSON: a comment or keep-alive
    }
  }
  return last
}

class Upstream {
  constructor(base = webUrl()) {
    this.url = `${base}/api/mcp/oasis?agentType=claude-code`
    this.session = null
    this.starting = null
    this.seq = 0
  }

  async post(body, session, timeoutMs = 15000) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (session) headers['mcp-session-id'] = session
    const bearer = token()
    if (bearer) headers.authorization = `Bearer ${bearer}`
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    return { res, text }
  }

  async start() {
    const id = `oasis-proxy-init-${++this.seq}`
    const { res, text } = await this.post({
      jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'oasis-plugin', version: VERSION } },
    })
    if (!res.ok) throw new Error(`The Oasis answered ${res.status}`)
    const reply = parseReply(res.headers.get('content-type'), text, id)
    if (!reply || reply.error) throw new Error(reply?.error?.message || 'The Oasis did not answer the handshake')
    const session = res.headers.get('mcp-session-id')
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session).catch(() => {})
    this.session = session
    return session
  }

  ready() {
    if (this.session) return Promise.resolve(this.session)
    return (this.starting ??= this.start().finally(() => { this.starting = null }))
  }

  /** Sends one request; a session the Oasis forgot (it restarted) is opened again once. */
  async request(method, params, timeoutMs) {
    for (let attempt = 0; ; attempt++) {
      const session = await this.ready()
      const id = `oasis-proxy-${++this.seq}`
      const { res, text } = await this.post({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }, session, timeoutMs)
      if ((res.status === 404 || res.status === 400) && attempt === 0) {
        this.session = null
        continue
      }
      if (!res.ok) throw new Error(`The Oasis answered ${res.status}: ${text.slice(0, 200)}`)
      const reply = parseReply(res.headers.get('content-type'), text, id)
      if (!reply) throw new Error('The Oasis sent an empty answer')
      return reply
    }
  }
}

const NOT_RUNNING = 'The Oasis is not running on this machine. Type /oasis to start it, then try again.'

export function createServer({ write, upstream = new Upstream(), retryMs = RETRY_MS } = {}) {
  let hadTools = false
  let timer = null
  const send = (message) => write(`${JSON.stringify(message)}\n`)

  /** While the Oasis is down, look again every few seconds and say so when its tools appear. */
  function watch() {
    if (timer || !retryMs) return
    timer = setInterval(async () => {
      try {
        const reply = await upstream.request('tools/list')
        if (offered(reply.result?.tools).length) {
          clearInterval(timer)
          timer = null
          hadTools = true
          send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
        }
      } catch {
        // still down
      }
    }, retryMs)
    timer.unref?.()
  }

  async function handle(message) {
    const { id, method, params } = message
    const isRequest = id !== undefined && id !== null
    if (!method) return // an answer to something we never asked
    if (!isRequest) return // notifications (initialized, cancelled): nothing to pass on
    try {
      if (method === 'initialize') {
        return send({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: params?.protocolVersion || PROTOCOL,
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: NAME, title: 'The Oasis', version: VERSION },
            instructions: 'World tools of the Oasis, a 3D village on this machine: look at the world, place and change things, take screenshots. They work while the Oasis is running (/oasis starts it).',
          },
        })
      }
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
      if (method === 'tools/list') {
        let tools = []
        try {
          tools = offered((await upstream.request('tools/list')).result?.tools)
        } catch {
          tools = []
        }
        if (tools.length) hadTools = true
        else watch()
        return send({ jsonrpc: '2.0', id, result: { tools } })
      }
      if (method === 'tools/call') {
        const name = params?.name
        if (!name || isExcluded(name)) {
          return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `The Oasis plugin does not offer the tool "${name}".` }] } })
        }
        let reply
        try {
          reply = await upstream.request('tools/call', params, CALL_TIMEOUT_MS)
        } catch (error) {
          if (hadTools) watch()
          const down = /fetch failed|ECONNREFUSED|timeout|aborted/i.test(`${error?.message} ${error?.cause?.message || ''}`)
          return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: down ? NOT_RUNNING : `The Oasis could not run ${name}: ${error.message}` }] } })
        }
        return send(reply.error ? { jsonrpc: '2.0', id, error: reply.error } : { jsonrpc: '2.0', id, result: reply.result })
      }
      if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } })
      if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } })
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
    } catch (error) {
      return send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error?.message || error) } })
    }
  }

  return { handle, stop: () => { if (timer) clearInterval(timer) } }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const server = createServer({ write: (line) => process.stdout.write(line) })
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
      return
    }
    for (const one of Array.isArray(message) ? message : [message]) void server.handle(one)
  })
  lines.on('close', () => { server.stop(); process.exit(0) })
}
