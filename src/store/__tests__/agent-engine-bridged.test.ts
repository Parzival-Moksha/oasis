import { describe, expect, it } from 'vitest'
import { agentEngineReducer, createAgentState, createInitialAgentEngineState } from '../slices/agentEngineSlice'
import type { EngineAgentSnapshot } from '../../lib/agent-engine-types'
import { canTalkTo } from '../../components/village/village-status'

// A desktop-app session running the Oasis plugin's mod: the engine marks its watcher bridged and talkable.

function snap(id: string, patch: Partial<EngineAgentSnapshot> = {}): EngineAgentSnapshot {
  return { id, kind: id.startsWith('obs-') ? 'observer' : 'owned', name: id, status: 'idle', sessionId: '7d97fabf-a39a-46be-83c5-f3def276478f', ...patch }
}

describe('bridged sessions', () => {
  it('a watched session with a live bridge can be talked to', () => {
    const state = agentEngineReducer(createInitialAgentEngineState(), { type: 'hello', agents: [snap('obs-1', { bridged: true, readOnly: false })], at: 1 })
    const agent = state.agents['obs-1']
    expect(agent).toMatchObject({ kind: 'observer', owned: false, bridged: true, readOnly: false })
    expect(canTalkTo(agent)).toBe(true)
  })

  it('goes back to read-only when the bridge goes quiet (the next snapshot has no bridged flag)', () => {
    let state = agentEngineReducer(createInitialAgentEngineState(), { type: 'hello', agents: [snap('obs-1', { bridged: true, readOnly: false })], at: 1 })
    state = agentEngineReducer(state, { type: 'agents', agents: [snap('obs-1')], at: 2 })
    expect(state.agents['obs-1']).toMatchObject({ bridged: false, readOnly: true })
    expect(canTalkTo(state.agents['obs-1'])).toBe(false)
    // ...and talkable again when it checks in again
    state = agentEngineReducer(state, { type: 'agents', agents: [snap('obs-1', { bridged: true, readOnly: false })], at: 3 })
    expect(state.agents['obs-1']).toMatchObject({ bridged: true, readOnly: false })
  })

  it('plain watched sessions stay read-only, even if a snapshot says readOnly: false', () => {
    const agent = createAgentState('obs-2', 1, snap('obs-2', { readOnly: false }))
    expect(agent).toMatchObject({ bridged: false, readOnly: true })
    expect(canTalkTo(agent)).toBe(false)
  })

  it('owned agents are never "bridged" and keep their own readOnly', () => {
    const agent = createAgentState('agent-a', 1, snap('agent-a', { bridged: true }))
    expect(agent).toMatchObject({ owned: true, bridged: false, readOnly: false })
    expect(canTalkTo(agent)).toBe(true)
    expect(createAgentState('agent-b', 1, snap('agent-b', { readOnly: true })).readOnly).toBe(true)
  })

  it('bridged sessions never get permission cards to answer: the desktop app handles those', () => {
    const agent = createAgentState('obs-3', 1, snap('obs-3', {
      bridged: true,
      readOnly: false,
      permissions: [{ requestId: 'r1', requestKind: 'permission', toolName: 'Write' }],
    }))
    expect(agent.decisions).toEqual([])
  })

  it('canTalkTo handles a missing agent', () => {
    expect(canTalkTo(undefined)).toBe(false)
    expect(canTalkTo(null)).toBe(false)
  })
})
