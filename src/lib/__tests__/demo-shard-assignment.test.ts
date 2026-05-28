import { describe, expect, it } from 'vitest'

import { chooseDemoShardAssignment, type DemoShardCandidate } from '../demo-shard-assignment'

function shard(id: string, players: number, order: number): DemoShardCandidate {
  return {
    id,
    players,
    createdAt: new Date(2026, 4, 28, 12, 0, order),
  }
}

describe('chooseDemoShardAssignment', () => {
  it('fills the least-populated shard below target cap first', () => {
    const choice = chooseDemoShardAssignment([
      shard('one', 7, 1),
      shard('two', 3, 2),
    ], { targetCap: 8, hardCap: 12, maxShards: 16 })

    expect(choice).toMatchObject({ type: 'existing', candidate: { id: 'two' } })
  })

  it('creates a fresh shard instead of filling old shards past target', () => {
    const choice = chooseDemoShardAssignment([
      shard('one', 8, 1),
      shard('two', 11, 2),
    ], { targetCap: 8, hardCap: 12, maxShards: 16 })

    expect(choice).toEqual({ type: 'create' })
  })

  it('uses hard-cap overflow only after max shards already exist', () => {
    const shards = Array.from({ length: 3 }, (_, index) => shard(`s${index + 1}`, 8 + index, index))
    const choice = chooseDemoShardAssignment(shards, { targetCap: 8, hardCap: 12, maxShards: 3 })

    expect(choice).toMatchObject({ type: 'existing', candidate: { id: 's1' } })
  })

  it('reports full when every shard is at hard cap', () => {
    const choice = chooseDemoShardAssignment([
      shard('one', 12, 1),
      shard('two', 12, 2),
    ], { targetCap: 8, hardCap: 12, maxShards: 2 })

    expect(choice).toEqual({ type: 'full' })
  })
})
