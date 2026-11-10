import { describe, expect, it } from 'vitest'

import { AnorakDigest, formatDuration, splitForTelegram } from '../telegram/anorak-digest'

const MIN = 60_000

describe('formatDuration', () => {
  it('reads like the owner said it', () => {
    expect(formatDuration(14 * MIN + 15_000)).toBe('14 min 15 sec')
    expect(formatDuration(45_000)).toBe('45 sec')
    expect(formatDuration(2 * MIN)).toBe('2 min')
    expect(formatDuration(62 * MIN)).toBe('1 h 2 min')
  })
})

describe('AnorakDigest', () => {
  it("a Telegram turn: the agent's words, conjuring time between them, and the total at the end", () => {
    const d = new AnorakDigest()
    d.claim('u1')
    expect(d.push({ kind: 'user.sent', ts: 0, uuid: 'u1' })).toEqual([])
    expect(d.push({ kind: 'text', ts: 5_000, text: 'On it.' })).toEqual(['On it.'])
    expect(d.push({ kind: 'text', ts: 5_000 + 2 * MIN + 10_000, text: 'Found the bug.' })).toEqual(['🔮 conjured for 2 min 10 sec\n\nFound the bug.'])
    expect(d.push({ kind: 'turn.end', ts: 14 * MIN + 15_000, outcome: 'done-waiting' })).toEqual(['✓ done · conjured for 14 min 15 sec'])
  })

  it('no tool chatter, no helper (subagent) text', () => {
    const d = new AnorakDigest()
    d.claim('u1')
    d.push({ kind: 'user.sent', ts: 0, uuid: 'u1' })
    expect(d.push({ kind: 'tool.start', ts: 100, name: 'Read' })).toEqual([])
    expect(d.push({ kind: 'text', ts: 200, text: 'helper words', parentToolUseId: 'toolu_1' })).toEqual([])
  })

  it('idle time between turns is not counted', () => {
    const d = new AnorakDigest({ followAll: true })
    d.push({ kind: 'user.sent', ts: 0 })
    d.push({ kind: 'turn.end', ts: 30_000, outcome: 'done-waiting' })
    // an hour later
    d.push({ kind: 'user.sent', ts: 60 * MIN })
    expect(d.push({ kind: 'text', ts: 60 * MIN + 5_000, text: 'hi' })).toEqual(['hi'])
    expect(d.push({ kind: 'turn.end', ts: 60 * MIN + 10_000 })).toEqual(['✓ done · conjured for 10 sec'])
  })

  it("turns started inside the Oasis stay there unless following all", () => {
    const d = new AnorakDigest()
    d.push({ kind: 'user.sent', ts: 0, uuid: 'from-oasis' })
    expect(d.push({ kind: 'text', ts: 1000, text: 'private' })).toEqual([])
    expect(d.push({ kind: 'turn.end', ts: 2000 })).toEqual([])
    d.followAll = true
    d.push({ kind: 'user.sent', ts: 3000 })
    expect(d.push({ kind: 'text', ts: 4000, text: 'shared' })).toEqual(['shared'])
  })

  it('errors and decisions say so', () => {
    const d = new AnorakDigest({ followAll: true })
    d.push({ kind: 'user.sent', ts: 0 })
    expect(d.push({ kind: 'turn.end', ts: MIN, outcome: 'error', reason: 'rate limit', isError: true })).toEqual(['⚠ stopped after 1 min: rate limit'])
    d.push({ kind: 'user.sent', ts: 2 * MIN })
    expect(d.push({ kind: 'turn.end', ts: 3 * MIN, outcome: 'needs-decision' })[0]).toMatch(/^✋ needs you/)
  })
})

describe('splitForTelegram', () => {
  it('keeps messages under the limit, preferring paragraph breaks', () => {
    const para = 'a'.repeat(3000)
    const parts = splitForTelegram(`${para}\n\n${para}`, 4000)
    expect(parts).toHaveLength(2)
    expect(parts.every(part => part.length <= 4000)).toBe(true)
  })
})
