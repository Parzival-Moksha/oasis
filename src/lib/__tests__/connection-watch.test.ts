import { describe, expect, it } from 'vitest'

import { ENGINE_GRACE_MS, SERVER_FAILS_DOWN, connectionWarnings, type WatchInput } from '../connection-watch'

const base: WatchInput = { now: 100_000, engine: null, serverFailures: 0, relay: null }
const ids = (input: Partial<WatchInput>) => connectionWarnings({ ...base, ...input }).map(w => w.id)

describe('connectionWarnings', () => {
  it('says nothing when everything is up', () => {
    expect(ids({ engine: { status: 'open', since: 0, nextRetryAt: null, error: null }, relay: { running: true, seen: true } })).toEqual([])
  })

  it('flags the Oasis server only after repeated failed checks', () => {
    expect(ids({ serverFailures: SERVER_FAILS_DOWN - 1 })).toEqual([])
    expect(ids({ serverFailures: SERVER_FAILS_DOWN })).toEqual(['oasis'])
  })

  it('gives the engine a grace period to connect, then flags it with the retry countdown', () => {
    const engine = (since: number) => ({ status: 'offline' as const, since, nextRetryAt: base.now + 4_200, error: 'refused' })
    expect(ids({ engine: engine(base.now - ENGINE_GRACE_MS + 1) })).toEqual([])
    const lines = connectionWarnings({ ...base, engine: engine(base.now - ENGINE_GRACE_MS) })
    expect(lines.map(l => l.id)).toEqual(['engine'])
    expect(lines[0].detail).toContain('retry in 5s')
    expect(lines[0].action).toBe('retry-engine')
  })

  it('a still-connecting engine counts as down after the grace period too', () => {
    expect(ids({ engine: { status: 'connecting', since: 0, nextRetryAt: null, error: null } })).toEqual(['engine'])
  })

  it('ignores an engine this page does not use', () => {
    expect(ids({ engine: { status: 'disabled', since: 0, nextRetryAt: null, error: null } })).toEqual([])
  })

  it('flags the relay only once it was seen running, and not while its status is unknown', () => {
    expect(ids({ relay: { running: false, seen: false } })).toEqual([])
    expect(ids({ relay: { running: false, seen: true } })).toEqual(['relay'])
    expect(ids({ relay: { running: null, seen: true } })).toEqual([])
  })

  it('with the server down, the relay (checked through it) is not reported on top', () => {
    expect(ids({ serverFailures: SERVER_FAILS_DOWN, relay: { running: false, seen: true } })).toEqual(['oasis'])
  })
})
