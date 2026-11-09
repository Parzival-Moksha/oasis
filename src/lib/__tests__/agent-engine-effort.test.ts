import { describe, expect, it } from 'vitest'
import { applySnapshot, createAgentState, foldAgentEvent } from '../../store/slices/agentEngineSlice'
import type { EngineAgentSnapshot, EngineEvent } from '../agent-engine-types'

const live = { focused: false, live: true }
const snap = (fields: Partial<EngineAgentSnapshot>): EngineAgentSnapshot => ({ id: 'agent-1', kind: 'owned', name: 'Rick', status: 'idle', ...fields })
const event = (kind: string, fields: Record<string, unknown>) => ({ v: 1, agentId: 'agent-1', ts: 2000, kind, ...fields }) as EngineEvent

describe('thinking effort in the agent slice', () => {
  it('takes the effort and what the CLI runs with from snapshots, and null means "back to the default"', () => {
    let agent = applySnapshot(createAgentState('agent-1', 1000), snap({ effort: 'high', resolvedEffort: 'high' }), 1000)
    expect([agent.effort, agent.resolvedEffort]).toEqual(['high', 'high'])
    agent = applySnapshot(agent, snap({ effort: null, resolvedEffort: 'medium' }), 1100)
    expect([agent.effort, agent.resolvedEffort]).toEqual([null, 'medium'])
    // An observer snapshot has no effort fields: keep what we know.
    agent = applySnapshot(agent, snap({}), 1200)
    expect([agent.effort, agent.resolvedEffort]).toEqual([null, 'medium'])
  })

  it('folds effort events into the agent with a notice, and model / meta events refresh the resolved level', () => {
    let agent = createAgentState('agent-1', 1000, snap({}))
    agent = foldAgentEvent(agent, event('effort', { effort: 'max', resolvedEffort: 'max' }), live)
    expect([agent.effort, agent.resolvedEffort]).toEqual(['max', 'max'])
    expect(agent.log.at(-1)).toMatchObject({ type: 'notice', text: 'Thinking effort -> max' })

    agent = foldAgentEvent(agent, event('effort', { effort: null, resolvedEffort: 'medium' }), live)
    expect(agent.effort).toBeNull()
    expect(agent.log.at(-1)).toMatchObject({ text: 'Thinking effort -> default (medium)' })

    agent = foldAgentEvent(agent, event('effort', { effort: 'low', applied: 'on next start' }), live)
    expect(agent.effort).toBe('low')
    expect(agent.resolvedEffort).toBe('medium') // the stopped process has not started at low yet
    expect(agent.log.at(-1)).toMatchObject({ text: 'Thinking effort -> low (on next start)' })

    agent = foldAgentEvent(agent, event('model', { model: 'sonnet', resolved: 'claude-sonnet-5-5', resolvedEffort: 'low' }), live)
    expect(agent.resolvedEffort).toBe('low')
    agent = foldAgentEvent(agent, event('meta', { models: [{ value: 'haiku', supportsEffort: true, supportedEffortLevels: ['low', 'medium'] }], resolvedEffort: 'medium' }), live)
    expect(agent.resolvedEffort).toBe('medium')
    expect(agent.models?.[0].supportedEffortLevels).toEqual(['low', 'medium'])
  })
})
