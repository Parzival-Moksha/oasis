// The Council: the circle (village-council.ts), walking on a stage (village-follow.ts stepStage), and the
// engine's door to it (packages/oasis-agent-engine/src/stage.js) with the agent's own voice (voice.js, agent.js).
import { describe, expect, it } from 'vitest'
import { COUNCIL, councilAngle, councilFront, councilPlaces, councilRadius, spokenSeconds } from '../village/village-council'
import { createFollowState, stepStage, type FollowState } from '../village/village-follow'
import * as stageModule from '../../../packages/oasis-agent-engine/src/stage.js'
import * as voiceModule from '../../../packages/oasis-agent-engine/src/voice.js'
import * as agentModule from '../../../packages/oasis-agent-engine/src/agent.js'

const CENTER = { x: 10, z: 20 }
const DT = 1 / 60

describe('the circle around the fire', () => {
  it('puts everyone on the circle, evenly, facing the centre', () => {
    const places = councilPlaces(5, CENTER, 4)
    expect(places).toHaveLength(5)
    for (const place of places) {
      expect(Math.hypot(place.x - CENTER.x, place.z - CENTER.z)).toBeCloseTo(4, 5)
      // One step along its facing brings it closer to the fire.
      const ahead = { x: place.x + Math.sin(place.yaw), z: place.z + Math.cos(place.yaw) }
      expect(Math.hypot(ahead.x - CENTER.x, ahead.z - CENTER.z)).toBeCloseTo(3, 5)
    }
    const gap = (a: number, b: number) => Math.hypot(places[a].x - places[b].x, places[a].z - places[b].z)
    expect(gap(0, 1)).toBeCloseTo(gap(1, 2), 5)
    expect(gap(4, 0)).toBeCloseTo(gap(0, 1), 5)
  })

  it('leaves the owner’s place in the circle free', () => {
    const owner = { x: CENTER.x, z: CENTER.z - 4 }
    const angle = councilAngle(CENTER, owner)
    const places = councilPlaces(3, CENTER, 4, angle)
    // Four places on the circle, the owner's among them: everyone a quarter turn apart, nobody on the owner.
    for (const place of places) expect(Math.hypot(place.x - owner.x, place.z - owner.z)).toBeGreaterThan(4)
    const angles = places.map(place => councilAngle(CENTER, place))
    expect(Math.abs(Math.cos(angles[0] - angle))).toBeLessThan(1e-6)
    expect(Math.cos(angles[1] - angle)).toBeCloseTo(-1, 5)
  })

  it('grows with the number of people and never crowds', () => {
    expect(councilRadius(5, true)).toBe(COUNCIL.minRadius)
    expect(councilRadius(5, true, 6)).toBe(6)
    const big = councilRadius(20, true)
    expect((2 * Math.PI * big) / 21).toBeGreaterThanOrEqual(COUNCIL.spacing - 1e-6)
    expect(councilRadius(2, false, 0.2)).toBeGreaterThanOrEqual(1.5)
  })

  it('a speaker steps toward the fire, never into it', () => {
    const [place] = councilPlaces(1, CENTER, 4)
    const front = councilFront(place, CENTER)
    expect(Math.hypot(front.x - CENTER.x, front.z - CENTER.z)).toBeCloseTo(4 - COUNCIL.step, 5)
    const close = councilFront({ x: CENTER.x, z: CENTER.z + 1 }, CENTER, 5)
    expect(Math.hypot(close.x - CENTER.x, close.z - CENTER.z)).toBeGreaterThanOrEqual(0.8 - 1e-6)
  })

  it('knows how long a clip takes at a speed', () => {
    expect(spokenSeconds(11.5, 1.15)).toBe(10)
    expect(spokenSeconds(0, 1)).toBe(0)
  })
})

describe('walking on the stage', () => {
  function staged(x: number, z: number): FollowState {
    return { ...createFollowState({ x, z, yaw: 0 }), mode: 'stage' }
  }
  function walk(state: FollowState, seconds: number, speed: number, face: { x: number; z: number }) {
    let settledAt = -1
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      if (stepStage(state, DT, false, speed, face.x, face.z).settled && settledAt < 0) settledAt = i * DT
    }
    return settledAt
  }

  it('goes to its mark, turns to the fire, and says it is settled', () => {
    const state = staged(0, 0)
    state.goalX = 3
    state.goalZ = 4
    state.hasGoal = true
    const settledAt = walk(state, 8, 0, CENTER)
    expect(settledAt).toBeGreaterThan(0)
    expect(state).toMatchObject({ x: 3, z: 4, act: 'stand' })
    expect(state.yaw).toBeCloseTo(Math.atan2(CENTER.x - 3, CENTER.z - 4), 2)
    // Nothing more happens: the caller writes no transform.
    expect(stepStage(state, DT, false, 0, CENTER.x, CENTER.z)).toMatchObject({ moved: false, turned: false, settled: true })
  })

  it('steps forward at a calm walk and back again, facing the fire at the end', () => {
    const [place] = councilPlaces(1, CENTER, 4)
    const front = councilFront(place, CENTER)
    const state = staged(place.x, place.z)
    state.yaw = place.yaw
    state.goalX = front.x
    state.goalZ = front.z
    state.hasGoal = true
    const forward = walk(state, 5, COUNCIL.walkSpeed, { x: CENTER.x, z: CENTER.z - 4 })
    // 1.3 m at 1.5 m/s: just under a second, plus the turn.
    expect(forward).toBeGreaterThan(0.7)
    expect(forward).toBeLessThan(2.5)
    state.goalX = place.x
    state.goalZ = place.z
    expect(walk(state, 6, COUNCIL.walkSpeed, CENTER)).toBeGreaterThan(0.7)
    expect(state.x).toBeCloseTo(place.x, 5)
    expect(state.yaw).toBeCloseTo(place.yaw, 2)
  })

  it('waits while frozen and does nothing without a mark', () => {
    const state = staged(0, 0)
    expect(stepStage(state, DT, false, 0, 1, 1)).toMatchObject({ moved: false, settled: false })
    state.goalX = 5
    state.hasGoal = true
    expect(stepStage(state, DT, true, 0, 1, 1)).toMatchObject({ moved: false, settled: false })
    expect(state.x).toBe(0)
  })
})

// ─── the engine's side ──────────────────────────────────────────────────────

interface StageApi {
  request: (msg: Record<string, unknown>) => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>
  result: (msg: Record<string, unknown>) => { ok: boolean; late?: boolean }
  pageClosed: (page: unknown) => void
  waiting: () => number
}
const { createStage, resolveStageAgent } = stageModule as unknown as {
  createStage: (deps: { pages: () => unknown[]; agents: () => Array<{ id: string; name: string }> }) => StageApi
  resolveStageAgent: (ref: unknown, agents: Array<{ id: string; name: string }>) => { id: string; name: string } | null
}
const { listVoices, isVoiceKey, voicePickNote, ENGINE_NOTE, VOICE_NOTE } = voiceModule as unknown as {
  listVoices: () => Array<{ key: string; name: string; sound: string }>
  isVoiceKey: (key: unknown) => boolean
  voicePickNote: (script: string) => string
  ENGINE_NOTE: RegExp
  VOICE_NOTE: string
}

const AGENTS = [{ id: 'agent-1', name: 'Anorak' }, { id: 'agent-2', name: 'Debugger' }, { id: 'agent-3', name: 'Tyler the Builder' }]

function stageWithPage() {
  const sent: Array<{ type: string; requestId: string; request: Record<string, unknown> }> = []
  const page = { readyState: 1, canStage: true, stageAt: 2, send: (raw: string) => sent.push(JSON.parse(raw)) }
  const old = { readyState: 1, canStage: true, stageAt: 1, send: () => { throw new Error('the older page must not be asked') } }
  const stage = createStage({ pages: () => [old, page, { readyState: 1, send: () => {} }], agents: () => AGENTS })
  return { stage, sent }
}

describe('engine: the council command', () => {
  it('finds an agent by id or by name', () => {
    expect(resolveStageAgent('agent-2', AGENTS)?.name).toBe('Debugger')
    expect(resolveStageAgent('debugger', AGENTS)?.id).toBe('agent-2')
    expect(resolveStageAgent('tyler', AGENTS)?.id).toBe('agent-3')
    // The start of a name only when it means one agent.
    expect(resolveStageAgent('de', [...AGENTS, { id: 'agent-4', name: 'Designer' }])).toBeNull()
    expect(resolveStageAgent('nobody', AGENTS)).toBeNull()
    expect(resolveStageAgent('', AGENTS)).toBeNull()
  })

  it('hands a step to the page that staged last and answers when the page is done', async () => {
    const { stage, sent } = stageWithPage()
    const pending = stage.request({ action: 'start', agents: ['Anorak', 'debugger'], center: [1, 0, 2], radius: 4 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'stage.request', request: { action: 'start', agentIds: ['agent-1', 'agent-2'], center: [1, 2], radius: 4 } })
    expect(stage.waiting()).toBe(1)
    stage.result({ requestId: sent[0].requestId, ok: true, data: { radius: 4 } })
    expect(await pending).toEqual({ ok: true, data: { radius: 4 } })
    expect(stage.waiting()).toBe(0)
    // A second answer for the same step is ignored.
    expect(stage.result({ requestId: sent[0].requestId, ok: true })).toMatchObject({ late: true })
  })

  it('passes a line, or asks for the agent’s next reply, and reports what the page could not do', async () => {
    const { stage, sent } = stageWithPage()
    const speak = stage.request({ action: 'speak', agent: 'Tyler', text: '  My week.  ' })
    expect(sent[0].request).toEqual({ action: 'speak', agentId: 'agent-3', text: 'My week.' })
    stage.result({ requestId: sent[0].requestId, ok: false, error: 'Tyler is not in this Council' })
    expect(await speak).toEqual({ ok: false, error: 'Tyler is not in this Council' })
    const next = stage.request({ action: 'turn', agent: 'agent-2', next: true, waitMs: 5000 })
    expect(sent[1].request).toEqual({ action: 'turn', agentId: 'agent-2', next: true, waitMs: 5000 })
    stage.result({ requestId: sent[1].requestId, ok: true, data: { seconds: 6.2 } })
    expect((await next).data).toEqual({ seconds: 6.2 })
  })

  it('keeps a running scene on the page that started it, and tells the caller at once when that page goes away', async () => {
    const sentA: Array<{ requestId: string }> = []
    const sentB: Array<{ requestId: string }> = []
    const a = { readyState: 1, canStage: true, stageAt: 1, send: (raw: string) => sentA.push(JSON.parse(raw)) }
    const b = { readyState: 1, canStage: true, stageAt: 0, send: (raw: string) => sentB.push(JSON.parse(raw)) }
    const pages = [a, b]
    const stage = createStage({ pages: () => pages, agents: () => AGENTS })
    const started = stage.request({ action: 'start', agents: ['Anorak'] })
    stage.result({ requestId: sentA[0].requestId, ok: true })
    await started
    // Another tab announces itself later: the scene stays where it is.
    b.stageAt = 99
    const forward = stage.request({ action: 'forward', agent: 'Anorak' })
    expect(sentA).toHaveLength(2)
    expect(sentB).toHaveLength(0)
    // The page reloads in the middle of the step.
    pages.splice(0, 1)
    stage.pageClosed(a)
    expect(await forward).toMatchObject({ ok: false, error: expect.stringMatching(/went away/) })
    expect(stage.waiting()).toBe(0)
    // The next step goes to the page that is left.
    void stage.request({ action: 'status' })
    expect(sentB).toHaveLength(1)
  })

  it('refuses what makes no sense, before any page is asked', () => {
    const { stage, sent } = stageWithPage()
    expect(() => stage.request({ action: 'dance' })).toThrow(/unknown action/)
    expect(() => stage.request({ action: 'start', agents: [] })).toThrow(/agents/)
    expect(() => stage.request({ action: 'start', agents: ['Anorak', 'anorak'] })).toThrow(/twice/)
    expect(() => stage.request({ action: 'forward', agent: 'nobody' })).toThrow(/no agent/)
    expect(() => stage.request({ action: 'speak', agent: 'Anorak' })).toThrow(/text/)
    expect(() => stage.request({ action: 'prepare', agent: 'Anorak', next: true })).toThrow(/text/)
    expect(sent).toHaveLength(0)
    const nobody = createStage({ pages: () => [{ readyState: 1, send: () => {} }], agents: () => AGENTS })
    expect(() => nobody.request({ action: 'status' })).toThrow(/no Oasis page/)
  })
})

describe('engine: an agent picks its own voice', () => {
  interface AgentLike {
    voiceChoice: string | null
    proc: unknown
    send: (text: string) => Promise<unknown>
    setVoiceChoice: (voice: string | null) => { ok: boolean; error?: string; data?: { voiceChoice: string | null } }
    rosterEntry: () => Record<string, unknown>
    snapshot: () => Record<string, unknown>
  }
  const { Agent } = agentModule as unknown as { Agent: new (spec: Record<string, unknown>, hub: Record<string, unknown>) => AgentLike }
  function makeAgent(spec: Record<string, unknown>) {
    const written: Array<{ message: { content: unknown } }> = []
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
    const hub = { emit: (_id: string, kind: string, payload: Record<string, unknown>) => events.push({ kind, payload }), persist: () => {}, log: () => {} }
    const agent = new Agent({ id: 'agent-1', cwd: process.cwd(), eyes: false, ...spec }, hub)
    agent.proc = { pid: 1, stdin: { write: (line: string) => written.push(JSON.parse(line)) } }
    return { agent, written, events }
  }

  it('reads the same list the page offers', () => {
    const voices = listVoices()
    expect(voices.length).toBeGreaterThanOrEqual(20)
    expect(voices.every(voice => voice.key && voice.name && voice.sound)).toBe(true)
    expect(isVoiceKey('harry')).toBe(true)
    expect(isVoiceKey('nobody')).toBe(false)
  })

  it('keeps the choice in the roster and the snapshot, and refuses a voice that is not on the list', () => {
    const { agent, events } = makeAgent({ name: 'Rick' })
    expect(agent.snapshot().voiceChoice).toBeNull()
    expect(agent.setVoiceChoice('nobody')).toMatchObject({ ok: false })
    expect(agent.setVoiceChoice('harry')).toEqual({ ok: true, data: { voiceChoice: 'harry' } })
    expect(agent.rosterEntry().voiceChoice).toBe('harry')
    expect(agent.snapshot().voiceChoice).toBe('harry')
    expect(events.some(e => e.kind === 'voice' && e.payload.voiceChoice === 'harry')).toBe(true)
    expect(makeAgent({ name: 'Rick', voiceChoice: 'harry' }).agent.voiceChoice).toBe('harry')
    expect(makeAgent({ name: 'Rick', voiceChoice: 'gone' }).agent.voiceChoice).toBeNull()
    expect(agent.setVoiceChoice(null).data).toEqual({ voiceChoice: null })
  })

  it('tells a voiced agent once how to pick, and not at all once it has picked', async () => {
    const { agent, written } = makeAgent({ name: 'Anorak' })
    await agent.send('hello')
    const first = written[0].message.content as Array<{ type: string; text: string }>
    expect(first.map(block => block.text)).toEqual(['hello', VOICE_NOTE, expect.stringMatching(/pick your own voice/)])
    expect(ENGINE_NOTE.test(first[2].text)).toBe(true)
    expect(first[2].text).toContain('voice.mjs')
    await agent.send('again')
    expect((written[1].message.content as unknown[]).length).toBe(2)
    expect(agent.rosterEntry().voiceOffered).toBe(true)
    const chosen = makeAgent({ name: 'Anorak', voiceChoice: 'george' })
    await chosen.agent.send('hello')
    expect((chosen.written[0].message.content as unknown[]).length).toBe(2)
    expect(ENGINE_NOTE.test(voicePickNote('C:/x/voice.mjs'))).toBe(true)
  })
})
