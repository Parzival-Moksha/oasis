import { describe, expect, it } from 'vitest'
import {
  AGENT_LOG_LIMIT,
  agentEngineReducer,
  createInitialAgentEngineState,
  selectHistoryCursor,
  type AgentEngineState,
} from '../slices/agentEngineSlice'
import type { EngineAgentSnapshot, EngineEvent } from '../../lib/agent-engine-types'

// Scrolling up in a thread: older pieces of the transcript are prepended to the agent's log.

let clock = 5_000
function ev(agentId: string, kind: string, payload: Record<string, unknown> = {}): EngineEvent {
  clock += 10
  return { ...payload, v: 1, agentId, ts: clock, kind } as EngineEvent
}
function snap(id: string, patch: Partial<EngineAgentSnapshot> = {}): EngineAgentSnapshot {
  return { id, kind: id.startsWith('obs-') ? 'observer' : 'owned', name: id, status: 'idle', ...patch }
}
function hello(agents: EngineAgentSnapshot[], backlog: Record<string, EngineEvent[]> = {}): AgentEngineState {
  return agentEngineReducer(createInitialAgentEngineState(), { type: 'hello', agents, backlog, at: clock })
}
/** One turn from the transcript: prompt, text, a tool call and its result, the closing text. */
function turn(agentId: string, n: number, at: number, extra: Record<string, unknown> = {}): EngineEvent[] {
  return [
    ev(agentId, 'user', { text: `prompt ${n}`, at, ...extra }),
    ev(agentId, 'text', { text: `answer ${n}`, messageId: `m${n}`, at: at + 100, ...extra }),
    ev(agentId, 'tool.start', { toolUseId: `toolu_${n}`, name: 'Bash', summary: `Bash: echo ${n}`, at: at + 200, ...extra }),
    ev(agentId, 'tool.end', { toolUseId: `toolu_${n}`, output: `${n}`, at: at + 300, ...extra }),
    ev(agentId, 'text', { text: `done ${n}`, messageId: `n${n}`, at: at + 400, ...extra }),
  ]
}

describe('older history', () => {
  it('entries from transcript events remember their offset; the cursor is the oldest one', () => {
    const state = hello([snap('obs-1')], { 'obs-1': [ev('obs-1', 'init', { observed: true }), ...turn('obs-1', 5, 5000), ...turn('obs-1', 6, 6000)] })
    const agent = state.agents['obs-1']
    expect(agent.log[0].type).toBe('session')
    expect(agent.log.filter(e => e.type !== 'session').every(e => typeof e.at === 'number')).toBe(true)
    expect(agent.log.find(e => e.type === 'tool')?.at).toBe(5200) // tool.end did not move it
    expect(selectHistoryCursor(agent)).toEqual({ before: 5000 })
  })

  it('prepends an older piece under the session line, folded on its own, and moves the cursor', () => {
    let state = hello([snap('obs-1')], { 'obs-1': [ev('obs-1', 'init', { observed: true }), ...turn('obs-1', 5, 5000)] })
    state = agentEngineReducer(state, { type: 'history/older', agentId: 'obs-1', events: [...turn('obs-1', 3, 3000), ...turn('obs-1', 4, 4000)], from: 3000, done: false })
    const agent = state.agents['obs-1']
    expect(agent.log.map(e => (e.type === 'text' || e.type === 'user' ? e.text : e.type))).toEqual([
      'session',
      'prompt 3', 'answer 3', 'tool', 'done 3',
      'prompt 4', 'answer 4', 'tool', 'done 4',
      'prompt 5', 'answer 5', 'tool', 'done 5',
    ])
    expect(new Set(agent.log.map(e => e.key)).size).toBe(agent.log.length)
    expect(agent.log.filter(e => e.type === 'tool').every(e => e.type === 'tool' && e.status === 'done')).toBe(true)
    expect(agent.log[1].history).toBe(true)
    expect(selectHistoryCursor(agent)).toEqual({ before: 3000 })
    // The first piece reached: the start of the session, nothing more to load.
    state = agentEngineReducer(state, { type: 'history/older', agentId: 'obs-1', events: turn('obs-1', 1, 0), from: 0, done: true })
    expect(state.agents['obs-1'].historyStart).toBe(true)
    expect(selectHistoryCursor(state.agents['obs-1'])).toBeNull()
  })

  it('a tool call already shown is not shown twice; a call whose result is in a newer piece is done', () => {
    let state = hello([snap('obs-1')], { 'obs-1': turn('obs-1', 5, 5000) })
    const older = [
      ev('obs-1', 'text', { text: 'before', at: 4000 }),
      ev('obs-1', 'tool.start', { toolUseId: 'toolu_x', name: 'Read', summary: 'Read a.ts', at: 4100 }), // result came later
      ev('obs-1', 'tool.start', { toolUseId: 'toolu_5', name: 'Bash', summary: 'dup', at: 4200 }), // already shown
    ]
    state = agentEngineReducer(state, { type: 'history/older', agentId: 'obs-1', events: older, from: 4000, done: false })
    const tools = state.agents['obs-1'].log.filter(e => e.type === 'tool')
    expect(tools.map(e => e.type === 'tool' && e.toolUseId)).toEqual(['toolu_x', 'toolu_5'])
    expect(tools[0]).toMatchObject({ status: 'done', history: true })
  })

  it('owned agents with live entries anchor on their oldest tool call and re-read what was above it', () => {
    const live = [
      ev('agent-a', 'user', { text: 'live prompt' }),
      ev('agent-a', 'text', { text: 'live answer' }),
      ev('agent-a', 'tool.start', { toolUseId: 'toolu_live', name: 'Bash', summary: 'Bash: ls' }),
      ev('agent-a', 'tool.end', { toolUseId: 'toolu_live', output: 'x' }),
    ]
    let state = hello([snap('agent-a')], { 'agent-a': live })
    expect(selectHistoryCursor(state.agents['agent-a'])).toEqual({ before: null, anchor: 'toolu_live' })
    // The engine returns everything before the anchor's line, the live prompt and answer included.
    const older = [
      ev('agent-a', 'user', { text: 'old prompt', at: 100 }),
      ev('agent-a', 'text', { text: 'old answer', at: 200 }),
      ev('agent-a', 'user', { text: 'live prompt', at: 900 }),
      ev('agent-a', 'text', { text: 'live answer', at: 1000 }),
    ]
    state = agentEngineReducer(state, { type: 'history/older', agentId: 'agent-a', events: older, from: 100, done: false, anchor: 'toolu_live' })
    const texts = state.agents['agent-a'].log.map(e => (e.type === 'text' || e.type === 'user' ? e.text : e.type))
    expect(texts).toEqual(['old prompt', 'old answer', 'live prompt', 'live answer', 'tool'])
    expect(selectHistoryCursor(state.agents['agent-a'])).toEqual({ before: 100 })
  })

  it('an empty thread asks for the end of the transcript; one with nothing to anchor on cannot load', () => {
    const empty = hello([snap('obs-2')]).agents['obs-2']
    expect(selectHistoryCursor(empty)).toEqual({ before: null })
    const chatOnly = hello([snap('agent-b')], { 'agent-b': [ev('agent-b', 'user', { text: 'hi' }), ev('agent-b', 'text', { text: 'hello' })] }).agents['agent-b']
    expect(selectHistoryCursor(chatOnly)).toBeNull()
  })

  it('loaded history is not trimmed by the live cap', () => {
    let state = hello([snap('obs-1')], { 'obs-1': turn('obs-1', 999, 900_000) })
    const older: EngineEvent[] = []
    for (let n = 0; n < 100; n++) older.push(...turn('obs-1', n, n * 1000))
    state = agentEngineReducer(state, { type: 'history/older', agentId: 'obs-1', events: older, from: 0, done: true })
    expect(state.agents['obs-1'].log.length).toBeGreaterThan(AGENT_LOG_LIMIT)
    state = agentEngineReducer(state, { type: 'event', event: ev('obs-1', 'text', { text: 'new live line', at: 950_000 }) })
    const log = state.agents['obs-1'].log
    expect(log[0]).toMatchObject({ type: 'user', text: 'prompt 0' })
    expect(log.at(-1)).toMatchObject({ type: 'text', text: 'new live line' })
    expect(state.agents['obs-1'].historyStart).toBe(true)
  })
})
