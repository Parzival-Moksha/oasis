import { describe, expect, it } from 'vitest'
import { agentWorld, groupAgentsByWorld, isAgentHere } from '../village-worlds'

const base = { follows: false, calledTo: null, homeWorld: null, homeSpots: [] as string[] }

describe('agentWorld', () => {
  it('follows the owner, then a call, then its home world, then its one home spot, then the village', () => {
    expect(agentWorld({ ...base, follows: true, calledTo: 'b' }, 'v', 'cur')).toBe('cur')
    expect(agentWorld({ ...base, calledTo: 'b', homeWorld: 'h' }, 'v', 'cur')).toBe('b')
    expect(agentWorld({ ...base, homeWorld: 'h', homeSpots: ['z'] }, 'v', 'cur')).toBe('h')
    expect(agentWorld({ ...base, homeSpots: ['z'] }, 'v', 'cur')).toBe('z')
    expect(agentWorld({ ...base, homeSpots: ['z', 'y'] }, 'v', 'cur')).toBe('v')
    expect(agentWorld(base, 'v', 'cur')).toBe('v')
  })
  it('with no village world chosen, an agent without a place is everywhere', () => {
    const world = agentWorld(base, null, 'cur')
    expect(world).toBeNull()
    expect(isAgentHere(world, 'cur')).toBe(true)
    expect(isAgentHere('v', 'cur')).toBe(false)
  })
})

describe('groupAgentsByWorld', () => {
  it('puts this world first, the others by name, keeping the order inside', () => {
    const where: Record<string, string | null> = { a: 'z', b: 'n', c: 'cur', d: 'z', e: null }
    const groups = groupAgentsByWorld(['a', 'b', 'c', 'd', 'e'], id => where[id], 'cur', w => ({ cur: 'Current', z: 'Zen', n: 'Neon' } as Record<string, string>)[w])
    expect(groups.map(g => [g.name, g.here, g.ids.join('')])).toEqual([['Current', true, 'ce'], ['Neon', false, 'b'], ['Zen', false, 'ad']])
  })
  it('copes with no agents', () => {
    expect(groupAgentsByWorld([], () => null, 'cur', w => w)).toEqual([])
  })
})
