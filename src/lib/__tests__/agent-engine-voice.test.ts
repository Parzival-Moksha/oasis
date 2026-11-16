// Voice: the engine's side (packages/oasis-agent-engine/src/voice.js and the send path in agent.js) and the
// slice's `speak` flag. The engine is plain ESM JS; these pieces run without spawning a process.
import { describe, expect, it } from 'vitest'
import { applySnapshot, createAgentState } from '../../store/slices/agentEngineSlice'
import type { EngineAgentSnapshot } from '../agent-engine-types'
import { splitSpoken } from '../village/village-spoken'
import { speak, speechClipId } from '../village/village-speech-server'
import * as agentModule from '../../../packages/oasis-agent-engine/src/agent.js'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'
import * as voiceModule from '../../../packages/oasis-agent-engine/src/voice.js'

interface AgentLike {
  speak: boolean
  proc: unknown
  send: (text: string) => Promise<{ uuid: string }>
  setSpeak: (on: boolean) => { ok: boolean; data: { speak: boolean } }
  rosterEntry: () => { speak?: boolean; speakSet?: boolean }
  snapshot: () => { speak?: boolean }
}
const { Agent, EYES_CAPTION } = agentModule as unknown as {
  Agent: new (spec: Record<string, unknown>, hub: Record<string, unknown>) => AgentLike
  EYES_CAPTION: string
}
const { Normalizer } = normalizeModule as unknown as {
  Normalizer: new (agentId: string, emit: (kind: string, payload: Record<string, unknown>) => void, opts: { mode: string }) => { handleStream: (msg: unknown) => void }
}
const { VOICE_NOTE, VOICE_OFF_NOTE, ENGINE_NOTE, stripSpoken } = voiceModule as unknown as { VOICE_NOTE: string; VOICE_OFF_NOTE: string; ENGINE_NOTE: RegExp; stripSpoken: (text: string) => string }

function makeAgent(spec: Record<string, unknown>, eyes?: () => Promise<{ data: string; mediaType: string } | null>) {
  const written: Array<{ message: { content: unknown } }> = []
  const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
  const hub = { emit: (_id: string, kind: string, payload: Record<string, unknown>) => events.push({ kind, payload }), persist: () => {}, log: () => {}, eyes }
  // voiceOffered: the one-time "you may pick your own voice" note is tested with the Council (village-council.test.ts).
  const agent = new Agent({ id: 'agent-1', cwd: process.cwd(), eyes: false, voiceOffered: true, ...spec }, hub)
  agent.proc = { pid: 1, stdin: { write: (line: string) => written.push(JSON.parse(line)) } }
  return { agent, written, events }
}

describe('engine: voice', () => {
  it('is on by default for every agent; only the owner’s own choice switches it off, and the roster keeps that', () => {
    expect(makeAgent({ name: 'Anorak Pro' }).agent.speak).toBe(true)
    expect(makeAgent({ name: 'Rick' }).agent.speak).toBe(true)
    // A `speak: false` saved before the default changed was the old default, not a choice.
    expect(makeAgent({ name: 'Rick', speak: false }).agent.speak).toBe(true)
    expect(makeAgent({ name: 'Rick', speak: false, speakSet: true }).agent.speak).toBe(false)
    const { agent, events } = makeAgent({ name: 'Rick' })
    expect(agent.setSpeak(false)).toEqual({ ok: true, data: { speak: false } })
    expect(agent.rosterEntry()).toMatchObject({ speak: false, speakSet: true })
    expect(agent.snapshot().speak).toBe(false)
    expect(events.some(e => e.kind === 'speak' && e.payload.speak === false)).toBe(true)
  })

  it('adds the note to each message of a voiced agent, and nothing to the others', async () => {
    const voiced = makeAgent({ name: 'Anorak' })
    await voiced.agent.send('hello there')
    expect(voiced.written[0].message.content).toEqual([{ type: 'text', text: 'hello there' }, { type: 'text', text: VOICE_NOTE }])
    // The thread and the pending bookkeeping see the owner's own words.
    expect(voiced.events.find(e => e.kind === 'user.sent')?.payload).toMatchObject({ text: 'hello there' })
    // A slash command goes out as plain text, or the CLI would not take it as a command.
    await voiced.agent.send('/compact')
    expect(voiced.written[1].message.content).toBe('/compact')
    const quiet = makeAgent({ name: 'Rick', speak: false, speakSet: true })
    await quiet.agent.send('hello there')
    expect(quiet.written[0].message.content).toBe('hello there')
    // Switched off: the very next message says so once (no restart), and after that messages go out plain.
    voiced.agent.setSpeak(false)
    await voiced.agent.send('again')
    expect(voiced.written[2].message.content).toEqual([{ type: 'text', text: 'again' }, { type: 'text', text: VOICE_OFF_NOTE }])
    await voiced.agent.send('and again')
    expect(voiced.written[3].message.content).toBe('and again')
    expect(ENGINE_NOTE.test(VOICE_OFF_NOTE)).toBe(true)
  })

  it('rides after the eyes picture when both are on', async () => {
    const { agent, written } = makeAgent({ name: 'Anorak', eyes: true }, async () => ({ data: 'QUJD', mediaType: 'image/jpeg' }))
    await agent.send('look')
    expect(written[0].message.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'text', text: EYES_CAPTION },
      { type: 'text', text: VOICE_NOTE },
    ])
  })

  it('the note stays out of the thread', () => {
    expect(ENGINE_NOTE.test(VOICE_NOTE)).toBe(true)
    expect(ENGINE_NOTE.test(EYES_CAPTION)).toBe(true)
    expect(ENGINE_NOTE.test('[Oasis voice: x] and more')).toBe(false)
    const seen: string[] = []
    const norm = new Normalizer('agent-1', (kind, payload) => { if (kind === 'user') seen.push(String(payload.text)) }, { mode: 'live' })
    norm.handleStream({ type: 'user', isReplay: true, uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'hello there' }, { type: 'text', text: VOICE_NOTE }] } })
    expect(seen).toEqual(['hello there'])
  })

  it('asks for a line the page can find', () => {
    expect(VOICE_NOTE).toContain('<spoken>')
    expect(VOICE_NOTE).toContain('40 words')
    expect(splitSpoken('Done.\n<spoken>All done.</spoken>').spoken).toBe('All done.')
  })

  it('takes the spoken line out of text for Telegram', () => {
    expect(stripSpoken('Done.\n\n<spoken>All done.</spoken>')).toBe('Done.')
    expect(stripSpoken('Done.\n<spoken>clipped')).toBe('Done.')
    expect(stripSpoken('No tag.')).toBe('No tag.')
  })
})

describe('Voice switch in the agent slice', () => {
  const snap = (fields: Partial<EngineAgentSnapshot>): EngineAgentSnapshot => ({ id: 'agent-1', kind: 'owned', name: 'Anorak', status: 'idle', ...fields })

  it('follows the engine snapshot, and an engine older than the switch reads as null (voice off)', () => {
    let agent = createAgentState('agent-1', 1000)
    expect(agent.speak).toBeNull()
    agent = applySnapshot(agent, snap({}), 1050)
    expect(agent.speak).toBeNull()
    agent = applySnapshot(agent, snap({ speak: true }), 1100)
    expect(agent.speak).toBe(true)
    agent = applySnapshot(agent, snap({ speak: false }), 1200)
    expect(agent.speak).toBe(false)
  })
})

describe('speech route: the voice speed', () => {
  const env = { ELEVENLABS_API_KEY: 'test-key', OASIS_VILLAGE_SPEECH_DIR: `${process.env.TEMP || '/tmp'}/oasis-speech-test-${Date.now()}` }
  const fetcher = (bodies: Array<Record<string, any>>) => (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ audio_base64: 'QUJD', alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } }), { status: 200 })
  }) as unknown as typeof fetch

  it('sends ElevenLabs its speed setting, clamped to what it takes, and keeps one clip per speed', async () => {
    const bodies: Array<Record<string, any>> = []
    const fast = await speak('Hello there.', 'merlin', { env, fetcher: fetcher(bodies), speed: 1.2 })
    expect(bodies[0].voice_settings.speed).toBe(1.2)
    expect(fast.modelSpeed).toBe(1.2)
    const again = await speak('Hello there.', 'merlin', { env, fetcher: fetcher(bodies), speed: 1.2 })
    expect(again).toMatchObject({ id: fast.id, cached: true, modelSpeed: 1.2 })
    expect(bodies).toHaveLength(1)
    const plain = await speak('Hello there.', 'merlin', { env, fetcher: fetcher(bodies) })
    expect(bodies[1].voice_settings.speed).toBeUndefined()
    expect(plain.id).not.toBe(fast.id)
    const tooFast = await speak('Hello there.', 'merlin', { env, fetcher: fetcher(bodies), speed: 3 })
    expect(tooFast.id).toBe(fast.id)
    expect(bodies).toHaveLength(2)
  })

  it('names a clip made at the default speed as it did before speeds existed', () => {
    expect(speechClipId('x', 'v', 'm', 1)).toBe(speechClipId('x', 'v', 'm'))
    expect(speechClipId('x', 'v', 'm', 1.2)).not.toBe(speechClipId('x', 'v', 'm'))
  })
})
