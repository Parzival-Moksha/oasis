// packages/oasis-agent-engine/src/outcome.js: an agent's last turn survives an engine restart.
import { describe, expect, it } from 'vitest'
import * as outcomeModule from '../../../packages/oasis-agent-engine/src/outcome.js'

interface Outcome { outcome: string; reason: string | null; at: number | null }
const { restoreOutcome, statusForOutcome, outcomeForRoster, STOPPED_MID_TURN } = outcomeModule as unknown as {
  restoreOutcome: (entry: unknown) => Outcome | null
  statusForOutcome: (o: Outcome | null) => { status: string; reason: string }
  outcomeForRoster: (o: unknown, now?: number) => Outcome | null
  STOPPED_MID_TURN: string
}

describe('agent outcome across engine restarts', () => {
  it('a finished turn comes back as waiting, not idle', () => {
    const o = restoreOutcome({ id: 'a', cwd: 'x', lastOutcome: { outcome: 'done-waiting', reason: 'end_turn', at: 5 } })
    expect(o).toEqual({ outcome: 'done-waiting', reason: 'end_turn', at: 5 })
    expect(statusForOutcome(o).status).toBe('waiting')
  })

  it('a turn cut off by the restart wants a look', () => {
    const o = restoreOutcome({ id: 'a', cwd: 'x', turnOpenAt: 42, lastOutcome: { outcome: 'done-waiting' } })
    expect(o).toEqual({ outcome: 'error', reason: STOPPED_MID_TURN, at: 42 })
    expect(statusForOutcome(o)).toEqual({ status: 'error', reason: STOPPED_MID_TURN })
  })

  it('a turn that ended on a decision still needs you', () => {
    expect(statusForOutcome(restoreOutcome({ lastOutcome: { outcome: 'needs-decision', reason: 'permission' } })).status).toBe('needs-decision')
  })

  it('an agent that never ran a turn is idle and ready', () => {
    expect(restoreOutcome({ id: 'a', cwd: 'x' })).toBeNull()
    expect(statusForOutcome(null)).toEqual({ status: 'idle', reason: 'ready' })
  })

  it('the roster keeps only outcome, reason and time', () => {
    expect(outcomeForRoster({ outcome: 'done-waiting', reason: 'end_turn', usage: { input: 9 }, result: 'long text' }, 7)).toEqual({ outcome: 'done-waiting', reason: 'end_turn', at: 7 })
    expect(outcomeForRoster(null)).toBeNull()
  })
})
