import { describe, expect, it } from 'vitest'
import { fullAgentName, sessionTitles, thinkingLabel } from '../../components/village/village-agent-labels'
import type { EngineSessionMeta } from '../agent-engine-types'

const items = [
  { sessionId: 's1', path: 'a', cwd: 'C:/x', title: 'CPU thermal throttling investigation and fixes' },
  { sessionId: 's2', path: 'b', cwd: 'C:/y', title: 'Banana and fruit list' },
] as EngineSessionMeta[]

describe('agents menu labels', () => {
  it('shows the whole session title when the stored name was cut from it', () => {
    const titles = sessionTitles(items)
    expect(fullAgentName({ id: 'agent-1', name: 'CPU thermal throttling investiga', title: null, sessionId: 's1' }, titles))
      .toBe('CPU thermal throttling investigation and fixes')
    // A watched session carries its full title; agentDisplayName alone cuts it at 40.
    const long = 'Session recovery and Oasis progress notes from the weekend'
    expect(fullAgentName({ id: 'obs-1', name: 'observe 1234abcd', title: long, sessionId: 's9' })).toBe(long)
  })

  it("keeps a name the owner chose, and works without a session list", () => {
    const titles = sessionTitles(items)
    expect(fullAgentName({ id: 'agent-2', name: 'Fruit bot', title: null, sessionId: 's2' }, titles)).toBe('Fruit bot')
    expect(fullAgentName({ id: 'agent-3', name: 'Rick', title: null, sessionId: null })).toBe('Rick')
    expect(sessionTitles(items)).toBe(titles) // cached per list
  })

  it('says the thinking level in words', () => {
    expect(thinkingLabel({ owned: true, effort: 'high', resolvedEffort: 'high' })).toBe('high')
    expect(thinkingLabel({ owned: true, effort: null, resolvedEffort: 'medium' })).toBe('default (medium)')
    expect(thinkingLabel({ owned: true, effort: null, resolvedEffort: null })).toBe('default')
    expect(thinkingLabel({ owned: false, effort: null, resolvedEffort: null })).toBe('')
  })
})
