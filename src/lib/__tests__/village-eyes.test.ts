// Eyes: the camera pose (village-eyes.ts), the engine's send path (agent.js) and where the world tools come
// from (worldtools.js). The engine is plain ESM JS; these pieces run without spawning a process.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { computeEyesPose } from '../village/village-eyes'
import * as agentModule from '../../../packages/oasis-agent-engine/src/agent.js'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'
import * as worldtoolsModule from '../../../packages/oasis-agent-engine/src/worldtools.js'

type Picture = { data: string; mediaType: string } | null
interface AgentLike {
  eyes: boolean
  proc: unknown
  turnRunning: boolean
  send: (text: string) => Promise<{ uuid: string }>
  setEyes: (on: boolean) => unknown
  rosterEntry: () => { eyes?: boolean }
  snapshot: () => { eyes?: boolean }
}
const { Agent, EYES_CAPTION } = agentModule as unknown as {
  Agent: new (spec: Record<string, unknown>, hub: Record<string, unknown>) => AgentLike
  EYES_CAPTION: string
}
const { Normalizer } = normalizeModule as unknown as {
  Normalizer: new (agentId: string, emit: (kind: string, payload: Record<string, unknown>) => void, opts: { mode: string }) => { handleStream: (msg: unknown) => void }
}
const { pluginShipsWorldTools, worldToolsArgs, worldToolsUrl, WORLD_TOOLS_ALLOWED } = worldtoolsModule as unknown as {
  pluginShipsWorldTools: (cwd?: string, configDir?: string) => boolean
  worldToolsArgs: (opts?: { cwd?: string; viaPlugin?: boolean }) => string[]
  worldToolsUrl: () => string
  WORLD_TOOLS_ALLOWED: string[]
}

describe('computeEyesPose', () => {
  const station = { anchor: [10, 2, 5] as [number, number, number], rotationY: 0 } // faces +Z

  it('sits in front of the face at eye height and looks ahead with nobody around', () => {
    const pose = computeEyesPose(station)
    expect(pose.position[0]).toBeCloseTo(10)
    expect(pose.position[1]).toBeCloseTo(3.6)
    expect(pose.position[2]).toBeGreaterThan(5)
    expect(pose.target[2]).toBeGreaterThan(pose.position[2] + 4)
    expect(pose.target[0]).toBeCloseTo(10)
    expect(pose.target[1]).toBeLessThan(pose.position[1]) // a little down, toward the plaza floor
  })

  it('turns toward the owner in front', () => {
    const pose = computeEyesPose(station, [14, 3.5, 9.85])
    const yaw = Math.atan2(pose.target[0] - pose.position[0], pose.target[2] - pose.position[2])
    expect(yaw).toBeCloseTo(Math.PI / 4, 1)
  })

  it('never turns past 75 degrees, so its own head stays out of the picture', () => {
    const pose = computeEyesPose(station, [10, 3.5, -20]) // straight behind
    const yaw = Math.abs(Math.atan2(pose.target[0] - pose.position[0], pose.target[2] - pose.position[2]))
    expect(yaw).toBeLessThanOrEqual((75 * Math.PI) / 180 + 1e-6)
  })

  it('ignores an owner on top of it or far away, and bad numbers', () => {
    const rest = computeEyesPose(station)
    expect(computeEyesPose(station, [10, 3.6, 5.6])).toEqual(rest)
    expect(computeEyesPose(station, [500, 0, 500])).toEqual(rest)
    expect(computeEyesPose(station, [Number.NaN, 0, 0])).toEqual(rest)
  })
})

describe('engine: eyes on a message', () => {
  function makeAgent(spec: Record<string, unknown>, eyes?: (agentId: string) => Promise<Picture>) {
    const written: Array<{ message: { content: unknown }; uuid: string }> = []
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
    const hub = { emit: (_id: string, kind: string, payload: Record<string, unknown>) => events.push({ kind, payload }), persist: () => {}, log: () => {}, eyes }
    const agent = new Agent({ id: 'agent-1', cwd: process.cwd(), ...spec }, hub)
    agent.proc = { pid: 1, stdin: { write: (line: string) => written.push(JSON.parse(line)) } }
    return { agent, written, events }
  }

  it('is on by default for Anorak only, and the roster keeps the choice', () => {
    expect(makeAgent({ name: 'Anorak Pro' }).agent.eyes).toBe(true)
    expect(makeAgent({ name: 'Rick' }).agent.eyes).toBe(false)
    expect(makeAgent({ name: 'Anorak', eyes: false }).agent.eyes).toBe(false)
    const { agent, events } = makeAgent({ name: 'Rick' })
    agent.setEyes(true)
    expect(agent.rosterEntry().eyes).toBe(true)
    expect(agent.snapshot().eyes).toBe(true)
    expect(events.some(e => e.kind === 'eyes' && e.payload.eyes === true)).toBe(true)
  })

  it('attaches the picture as an image block in the same user message', async () => {
    const { agent, written, events } = makeAgent({ name: 'Anorak' }, async () => ({ data: 'QUJD', mediaType: 'image/jpeg' }))
    await agent.send('hello there')
    expect(written).toHaveLength(1)
    expect(written[0].message.content).toEqual([
      { type: 'text', text: 'hello there' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'text', text: EYES_CAPTION },
    ])
    expect(events.find(e => e.kind === 'user.sent')?.payload).toMatchObject({ text: 'hello there', eyes: true })
  })

  it('sends the text alone when there is no picture, the capture fails, or eyes are off', async () => {
    const none = makeAgent({ name: 'Anorak' }, async () => null)
    await none.agent.send('one')
    expect(none.written[0].message.content).toBe('one')
    const broken = makeAgent({ name: 'Anorak' }, async () => { throw new Error('no browser') })
    await broken.agent.send('two')
    expect(broken.written[0].message.content).toBe('two')
    let asked = 0
    const off = makeAgent({ name: 'Rick' }, async () => { asked += 1; return { data: 'QUJD', mediaType: 'image/jpeg' } })
    await off.agent.send('three')
    expect(off.written[0].message.content).toBe('three')
    expect(asked).toBe(0)
  })

  it('keeps the order of messages while one waits for its picture', async () => {
    let n = 0
    const { agent, written } = makeAgent({ name: 'Anorak' }, () => new Promise<Picture>(resolve => setTimeout(() => resolve(null), (n += 1) === 1 ? 40 : 0)))
    await Promise.all([agent.send('first'), agent.send('second')])
    expect(written.map(m => m.message.content)).toEqual(['first', 'second'])
  })

  it('the caption next to the picture stays out of the thread', () => {
    const seen: string[] = []
    const norm = new Normalizer('agent-1', (kind, payload) => { if (kind === 'user') seen.push(String(payload.text)) }, { mode: 'live' })
    norm.handleStream({
      type: 'user',
      isReplay: true,
      uuid: 'u1',
      message: { role: 'user', content: [{ type: 'text', text: 'hello there' }, { type: 'image', source: {} }, { type: 'text', text: EYES_CAPTION }] },
    })
    expect(seen).toEqual(['hello there'])
  })
})

describe('engine: where the world tools come from', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-worldtools-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
  }
  function setup(name: string, { url = worldToolsUrl(), enabled = true as boolean | null, mcp = true } = {}) {
    const config = path.join(dir, name)
    const installPath = path.join(config, 'plugins', 'cache', 'oasis', 'oasis', '0.2.0')
    write(path.join(config, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'oasis@oasis': [{ scope: 'user', installPath }] } })
    write(path.join(config, 'settings.json'), enabled === null ? {} : { enabledPlugins: { 'oasis@oasis': enabled } })
    if (mcp) write(path.join(installPath, '.mcp.json'), { mcpServers: { oasis: { type: 'http', url } } })
    else fs.mkdirSync(installPath, { recursive: true })
    return config
  }

  it('the plugin brings them when installed, enabled and pointing at this Oasis', () => {
    expect(pluginShipsWorldTools(undefined, setup('ok'))).toBe(true)
  })

  it('not when it is missing, disabled, older than the tools, or points elsewhere', () => {
    expect(pluginShipsWorldTools(undefined, path.join(dir, 'nothing'))).toBe(false)
    expect(pluginShipsWorldTools(undefined, setup('disabled', { enabled: false }))).toBe(false)
    expect(pluginShipsWorldTools(undefined, setup('unset', { enabled: null }))).toBe(false)
    expect(pluginShipsWorldTools(undefined, setup('old', { mcp: false }))).toBe(false)
    expect(pluginShipsWorldTools(undefined, setup('elsewhere', { url: 'http://127.0.0.1:9999/api/mcp/oasis' }))).toBe(false)
  })

  it('a folder can switch the plugin off for itself', () => {
    const config = setup('folder')
    const cwd = path.join(dir, 'project')
    write(path.join(cwd, '.claude', 'settings.json'), { enabledPlugins: { 'oasis@oasis': false } })
    expect(pluginShipsWorldTools(cwd, config)).toBe(false)
  })

  it('passes its own server only without the plugin, and pre-allows both tool names either way', () => {
    const own = worldToolsArgs({ viaPlugin: false })
    const viaPlugin = worldToolsArgs({ viaPlugin: true })
    expect(own).toContain('--mcp-config')
    expect(viaPlugin).not.toContain('--mcp-config')
    for (const args of [own, viaPlugin]) {
      const allowed = args[args.indexOf('--allowedTools') + 1].split(',')
      expect(allowed).toContain('mcp__oasis__screenshot_viewport')
      expect(allowed).toContain('mcp__plugin_oasis_oasis__screenshot_viewport')
    }
    // Paid or destructive tools keep asking.
    expect(WORLD_TOOLS_ALLOWED.some(t => /generate_|__conjure_|__craft_scene$|clear_world|load_world/.test(t))).toBe(false)
  })
})
