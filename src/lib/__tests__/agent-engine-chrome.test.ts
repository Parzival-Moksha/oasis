import { describe, expect, it } from 'vitest'
import { applySnapshot, createAgentState } from '../../store/slices/agentEngineSlice'
import type { EngineAgentSnapshot } from '../agent-engine-types'

const snap = (fields: Partial<EngineAgentSnapshot>): EngineAgentSnapshot => ({ id: 'agent-1', kind: 'owned', name: 'Tyler', status: 'idle', ...fields })

describe('Claude in Chrome switch in the agent slice', () => {
  it('follows the engine snapshot, and an engine older than the switch reads as null', () => {
    let agent = createAgentState('agent-1', 1000)
    expect(agent.chrome).toBeNull()
    agent = applySnapshot(agent, snap({ chrome: true }), 1100)
    expect(agent.chrome).toBe(true)
    agent = applySnapshot(agent, snap({ chrome: false }), 1200)
    expect(agent.chrome).toBe(false)
    // A snapshot without the field (older engine, an observer) keeps what we know.
    agent = applySnapshot(agent, snap({}), 1300)
    expect(agent.chrome).toBe(false)
  })
})

describe('a Chrome agent drives Chrome under its own permission mode', () => {
  it('starts with --chrome and no settings that force a question for every call', async () => {
    const { chromeArgs } = await import('../../../packages/oasis-agent-engine/src/chrome.js')
    const args = chromeArgs()
    expect(args).toEqual(['--chrome'])
    expect(args.join(' ')).not.toMatch(/--settings|ask/)
  })
})
