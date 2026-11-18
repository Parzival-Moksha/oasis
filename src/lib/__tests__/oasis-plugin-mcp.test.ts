// The world tools as the published plugin ships them: a local stdio server inside the plugin folder
// (plugins/oasis/mcp/oasis-mcp.mjs) that passes requests on to the Oasis on this machine.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as proxyModule from '../../../plugins/oasis/mcp/oasis-mcp.mjs'
import * as worldtoolsModule from '../../../packages/oasis-agent-engine/src/worldtools.js'

type Tool = { name: string; title?: string; annotations?: Record<string, unknown> }
type Message = { id?: number | string | null; method?: string; result?: Record<string, unknown>; error?: { code: number; message: string } }
const { createServer, offered, annotate, isExcluded, webUrl, parseReply } = proxyModule as unknown as {
  createServer: (opts: { write: (line: string) => void; upstream?: unknown; retryMs?: number }) => { handle: (m: unknown) => Promise<void>; stop: () => void }
  offered: (tools: Tool[]) => Tool[]
  annotate: (tool: Tool) => Tool
  isExcluded: (name: string) => boolean
  webUrl: (value?: string) => string
  parseReply: (contentType: string, text: string, id: unknown) => Message | null
}
const { pluginShipsWorldTools } = worldtoolsModule as unknown as { pluginShipsWorldTools: (cwd?: string, configDir?: string) => boolean }

describe('plugin world tools: what is offered', () => {
  it('never offers AI generation of pictures, video, music or speech', () => {
    for (const name of ['generate_image', 'generate_video', 'generate_voice', 'text_to_pic', 'text_to_pic_building', 'text_to_video', 'text_to_music', 'conjure_framed_picture', 'avatarpic_user', 'generate_something_new']) {
      expect(isExcluded(name)).toBe(true)
    }
    expect(offered([{ name: 'text_to_music' }, { name: 'place_object' }, { name: 'generate_voice' }]).map(t => t.name)).toEqual(['place_object'])
  })

  it('gives each tool a title and read-only / destructive hints', () => {
    expect(annotate({ name: 'get_world_state', title: 'get_world_state' })).toMatchObject({ title: 'Get world state', annotations: { readOnlyHint: true, destructiveHint: false } })
    expect(annotate({ name: 'remove_object' }).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect(annotate({ name: 'place_object' }).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    // What the Oasis itself says wins.
    expect(annotate({ name: 'place_object', title: 'Put a thing down', annotations: { destructiveHint: true } })).toMatchObject({ title: 'Put a thing down', annotations: { destructiveHint: true } })
  })

  it('only ever talks to this machine', () => {
    expect(webUrl('http://example.com:4516')).toBe('http://127.0.0.1:4516')
    expect(webUrl('https://127.0.0.1:4516')).toBe('http://127.0.0.1:4516')
    expect(webUrl('http://localhost:4599/')).toBe('http://localhost:4599')
    expect(webUrl('not a url')).toBe('http://127.0.0.1:4516')
    expect(webUrl('')).toBe('http://127.0.0.1:4516')
  })

  it('reads an answer from plain JSON or an event stream', () => {
    expect(parseReply('application/json', '{"jsonrpc":"2.0","id":"a","result":{}}', 'a')).toMatchObject({ id: 'a' })
    expect(parseReply('text/event-stream', 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":"a","result":{"ok":1}}\n\n', 'a')).toMatchObject({ id: 'a', result: { ok: 1 } })
  })
})

describe('plugin world tools: a session talking through it', () => {
  let server: http.Server
  let base = ''
  let sessions = 0
  let forget = false
  const seen: Array<{ method: string; auth: string; session: string }> = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const msg = JSON.parse(body || '{}') as { id?: string; method: string; params?: { name?: string } }
        const session = String(req.headers['mcp-session-id'] || '')
        seen.push({ method: msg.method, auth: String(req.headers.authorization || ''), session })
        const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { 'content-type': 'application/json', ...headers })
          res.end(JSON.stringify(value))
        }
        if (msg.method === 'initialize') return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, { 'mcp-session-id': `s${++sessions}` })
        if (forget && session !== `s${sessions + 1}`) {
          forget = false
          sessions++ // the Oasis restarted: the old session id means nothing now
          return json(404, { jsonrpc: '2.0', error: { code: -32000, message: 'Unknown MCP session' }, id: null })
        }
        if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end() }
        if (msg.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'get_world_info' }, { name: 'text_to_pic' }, { name: 'clear_world' }] } })
        if (msg.method === 'tools/call') {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `ran ${msg.params?.name}` }] } })}\n\n`)
        }
        return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } })
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close() })

  /** A proxy pointed at `url`, and a way to send it one request and get the answer. */
  function client(url: string, retryMs = 0) {
    const out: Message[] = []
    const previous = process.env.OASIS_WEB_URL
    process.env.OASIS_WEB_URL = url
    const proxy = createServer({ write: line => out.push(JSON.parse(line) as Message), retryMs })
    if (previous === undefined) delete process.env.OASIS_WEB_URL
    else process.env.OASIS_WEB_URL = previous
    let id = 0
    const ask = async (method: string, params?: unknown) => {
      const mine = ++id
      await proxy.handle({ jsonrpc: '2.0', id: mine, method, params })
      return out.find(m => m.id === mine) as Message
    }
    return { ask, out, proxy }
  }

  it('answers the handshake itself, lists the allowed tools and runs one', async () => {
    const { ask, proxy } = client(base)
    expect((await ask('initialize', { protocolVersion: '2025-06-18' })).result).toMatchObject({ serverInfo: { name: 'oasis' }, capabilities: { tools: { listChanged: true } } })
    const tools = (await ask('tools/list')).result?.tools as Tool[]
    expect(tools.map(t => t.name)).toEqual(['get_world_info', 'clear_world'])
    expect(tools[1].annotations).toMatchObject({ destructiveHint: true })
    expect((await ask('tools/call', { name: 'get_world_info', arguments: {} })).result).toMatchObject({ content: [{ text: 'ran get_world_info' }] })
    proxy.stop()
  })

  it('refuses an excluded tool without asking the Oasis', async () => {
    const { ask, proxy } = client(base)
    const before = seen.length
    expect((await ask('tools/call', { name: 'text_to_pic', arguments: {} })).result).toMatchObject({ isError: true })
    expect(seen.length).toBe(before)
    proxy.stop()
  })

  it('opens a new session when the Oasis restarted in between', async () => {
    const { ask, proxy } = client(base)
    await ask('tools/list')
    forget = true
    expect((await ask('tools/call', { name: 'get_world_info', arguments: {} })).result).toMatchObject({ content: [{ text: 'ran get_world_info' }] })
    proxy.stop()
  })

  it('sends the local token when there is one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-token-'))
    const file = path.join(dir, 'token')
    fs.writeFileSync(file, 'sesame\n')
    process.env.OASIS_TOKEN_FILE = file
    try {
      const { ask, proxy } = client(base)
      await ask('tools/list')
      expect(seen[seen.length - 1].auth).toBe('Bearer sesame')
      proxy.stop()
    } finally {
      delete process.env.OASIS_TOKEN_FILE
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('with the Oasis down: an empty list, a plain sentence, and the tools appear when it comes up', async () => {
    // A port nothing listens on: bind one, note it, close it.
    const spare = http.createServer()
    await new Promise<void>(resolve => spare.listen(0, '127.0.0.1', resolve))
    const port = (spare.address() as AddressInfo).port
    await new Promise(resolve => spare.close(resolve))

    const { ask, out, proxy } = client(`http://127.0.0.1:${port}`, 40)
    expect((await ask('tools/list')).result).toEqual({ tools: [] })
    const call = await ask('tools/call', { name: 'get_world_info', arguments: {} })
    expect(call.result).toMatchObject({ isError: true })
    expect(JSON.stringify(call.result)).toContain('/oasis')

    // The Oasis starts on that port.
    const late = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const msg = JSON.parse(body || '{}') as { id?: string; method: string }
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'late' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'tools/list' ? { tools: [{ name: 'place_object' }] } : {} }))
      })
    })
    await new Promise<void>(resolve => late.listen(port, '127.0.0.1', resolve))
    try {
      const deadline = Date.now() + 5000
      while (!out.some(m => m.method === 'notifications/tools/list_changed') && Date.now() < deadline) await new Promise(r => setTimeout(r, 25))
      expect(out.some(m => m.method === 'notifications/tools/list_changed')).toBe(true)
      expect(((await ask('tools/list')).result?.tools as Tool[]).map(t => t.name)).toEqual(['place_object'])
    } finally {
      proxy.stop()
      await new Promise(resolve => late.close(resolve))
    }
  })
})

describe('engine: the published plugin brings the world tools too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-plugin-stdio-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
  }
  function setup(name: string, server: unknown) {
    const config = path.join(dir, name)
    const installPath = path.join(config, 'plugins', 'cache', 'oasis', 'oasis', '0.5.0')
    write(path.join(config, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'oasis@oasis': [{ scope: 'user', installPath }] } })
    write(path.join(config, 'settings.json'), { enabledPlugins: { 'oasis@oasis': true } })
    write(path.join(installPath, '.mcp.json'), { mcpServers: { oasis: server } })
    return config
  }

  it('recognises the manifest the cut ships (plugins/oasis/mcp/directory.mcp.json)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../plugins/oasis/mcp/directory.mcp.json'), 'utf8')) as { mcpServers: { oasis: { command: string; args: string[] } } }
    expect(manifest.mcpServers.oasis.command).toBe('node')
    expect(manifest.mcpServers.oasis.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/mcp/oasis-mcp.mjs'])
    expect(pluginShipsWorldTools(undefined, setup('stdio', manifest.mcpServers.oasis))).toBe(true)
  })

  it('not some other local server', () => {
    expect(pluginShipsWorldTools(undefined, setup('other', { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/mcp/something-else.mjs'] }))).toBe(false)
  })
})
