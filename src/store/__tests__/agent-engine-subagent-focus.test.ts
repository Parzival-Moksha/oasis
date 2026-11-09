import { describe, expect, it } from 'vitest'
import { agentEngineReducer, createInitialAgentEngineState, type AgentEngineState } from '../slices/agentEngineSlice'
import type { EngineAgentSnapshot } from '../../lib/agent-engine-types'

// The village's subagent mini avatars: one subagent's work alone in its parent's panel (agentEngine.focusedSubagent).

function snap(id: string): EngineAgentSnapshot {
  return { id, kind: 'owned', name: id, status: 'working' }
}
function village(): AgentEngineState {
  return agentEngineReducer(createInitialAgentEngineState(), { type: 'hello', agents: [snap('agent-a'), snap('agent-b')], at: 1 })
}

describe('focusedSubagent', () => {
  it('starts empty, is set with an agent and a key, and cleared with null', () => {
    let state = village()
    expect(state.focusedSubagent).toBeNull()
    state = agentEngineReducer(state, { type: 'subagent/focus', agentId: 'agent-a', key: 'toolu_sub1' })
    expect(state.focusedSubagent).toEqual({ agentId: 'agent-a', key: 'toolu_sub1' })
    const same = agentEngineReducer(state, { type: 'subagent/focus', agentId: 'agent-a', key: 'toolu_sub1' })
    expect(same).toBe(state)
    state = agentEngineReducer(state, { type: 'subagent/focus', agentId: null })
    expect(state.focusedSubagent).toBeNull()
  })

  it('survives focusing its own agent (either order), ends when another agent opens or the panel closes', () => {
    let state = village()
    state = agentEngineReducer(state, { type: 'subagent/focus', agentId: 'agent-a', key: 'k1' })
    state = agentEngineReducer(state, { type: 'focus', agentId: 'agent-a' })
    expect(state.focusedSubagent).toEqual({ agentId: 'agent-a', key: 'k1' })
    state = agentEngineReducer(state, { type: 'focus', agentId: 'agent-b' })
    expect(state.focusedSubagent).toBeNull()
    state = agentEngineReducer(state, { type: 'focus', agentId: 'agent-a' })
    state = agentEngineReducer(state, { type: 'subagent/focus', agentId: 'agent-a', key: 'k2' })
    state = agentEngineReducer(state, { type: 'focus', agentId: null })
    expect(state.focusedSubagent).toBeNull()
  })
})
