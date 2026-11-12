import { describe, expect, it } from 'vitest'
import { agentEngineReducer, applySnapshot, createAgentState, createInitialAgentEngineState, selectAttentionQueue } from '../../store/slices/agentEngineSlice'
import type { EngineAgentSnapshot } from '../agent-engine-types'

const snap = (id: string, fields: Partial<EngineAgentSnapshot> = {}): EngineAgentSnapshot => ({ id, kind: 'owned', name: id, status: 'waiting', ...fields })

describe('agent state across reloads and engine restarts', () => {
  it('takes the last outcome time from the snapshot', () => {
    const agent = applySnapshot(createAgentState('a', 1000), snap('a', { lastOutcome: { outcome: 'done-waiting', reason: 'end_turn', at: 1500 } }), 1600)
    expect(agent.lastOutcomeAt).toBe(1500)
  })

  it('unseen/restore puts finished-while-away agents back in the attention queue, not the one you are looking at', () => {
    let state = agentEngineReducer(createInitialAgentEngineState(), { type: 'hello', agents: [snap('a'), snap('b')], backlog: {}, at: 1000 })
    expect(selectAttentionQueue(state)).toEqual([])
    state = agentEngineReducer(state, { type: 'focus', agentId: 'b' })
    state = agentEngineReducer(state, { type: 'unseen/restore', agentIds: ['a', 'b'], at: 2000 })
    expect(state.agents.a.unseen).toBe(true)
    expect(state.agents.b.unseen).toBe(false)
    expect(selectAttentionQueue(state)).toEqual(['a'])
  })
})
