import { describe, expect, it } from 'vitest'

import { planUnseenRestore, type SeenAgent } from '../village/village-seen'

const agent = (id: string, status: string, lastOutcomeAt: number | null, key = `s-${id}`): SeenAgent => ({ id, key, status, lastOutcomeAt })

describe('planUnseenRestore', () => {
  it('a turn that ended after your last look is unseen again after a reload', () => {
    const plan = planUnseenRestore([agent('a', 'waiting', 2000)], { 's-a': 1000 }, 5000)
    expect(plan.unseenIds).toEqual(['a'])
    expect(plan.seen['s-a']).toBe(1000) // still not looked at
  })

  it('a turn you already looked at stays seen', () => {
    expect(planUnseenRestore([agent('a', 'waiting', 2000)], { 's-a': 3000 }, 5000).unseenIds).toEqual([])
  })

  it('the first time this page sees an agent it takes a baseline instead of flagging it', () => {
    const plan = planUnseenRestore([agent('a', 'waiting', 2000)], {}, 5000)
    expect(plan.unseenIds).toEqual([])
    expect(plan.seen['s-a']).toBe(5000)
  })

  it('a working agent needs no look; an errored one (cut off by a restart) does', () => {
    const plan = planUnseenRestore([agent('w', 'working', 2000), agent('e', 'error', 2000)], { 's-w': 1000, 's-e': 1000 }, 5000)
    expect(plan.unseenIds).toEqual(['e'])
  })

  it('the agent you are looking at counts as seen now', () => {
    const plan = planUnseenRestore([agent('a', 'waiting', 2000)], { 's-a': 1000 }, 5000, 'a')
    expect(plan.unseenIds).toEqual([])
    expect(plan.seen['s-a']).toBe(5000)
  })

  it('an agent without an outcome (never ran a turn) is not flagged', () => {
    expect(planUnseenRestore([agent('a', 'idle', null)], { 's-a': 1000 }, 5000).unseenIds).toEqual([])
  })
})
