import { describe, expect, it } from 'vitest'
import { formatElapsed, miniSeats, subagentLook, SUBAGENT_RECENT_MS, visibleSubagents, MINI_ROW_SIZES } from '../village/village-subagents'
import { STATION } from '../village/village-layout'
import {
  agentEngineReducer,
  attentionRank,
  createInitialAgentEngineState,
  runningSubagentCount,
  SUBAGENT_STALE_MS,
  type EngineSubagentState,
} from '../../store/slices/agentEngineSlice'
import { VILLAGE_HELPERS_COLOR, villageAgentLook } from '../../components/village/village-status'
import type { EngineEvent } from '../agent-engine-types'

const sub = (key: string, fields: Partial<EngineSubagentState> = {}): EngineSubagentState => ({
  key, toolUseId: key, taskId: null, description: `helper ${key}`, subagentType: 'general-purpose', status: 'running', startedAt: 1000, ...fields,
})

describe('which helpers show', () => {
  it('shows running helpers and ones that finished within the last minute, oldest first', () => {
    const now = 100_000
    const agent = {
      subagents: [
        sub('b', { startedAt: 3000 }),
        sub('a', { startedAt: 2000, status: 'completed', endedAt: now - 10_000 }),
        sub('old', { startedAt: 1000, status: 'completed', endedAt: now - SUBAGENT_RECENT_MS - 1 }),
        sub('stale', { startedAt: now - SUBAGENT_STALE_MS - 1 }),
      ],
    }
    expect(visibleSubagents(agent, now).map(s => s.key)).toEqual(['a', 'b'])
  })

  it('reads the end status the way the owner thinks of it', () => {
    expect(subagentLook({ status: 'running' })).toBe('running')
    expect(subagentLook({ status: 'completed' })).toBe('done')
    expect(subagentLook({ status: 'stopped' })).toBe('stopped')
    expect(subagentLook({ status: 'killed' })).toBe('stopped')
    expect(subagentLook({ status: 'failed' })).toBe('failed')
  })

  it('says elapsed time short', () => {
    expect(formatElapsed(42_000)).toBe('42s')
    expect(formatElapsed(12 * 60_000 + 5000)).toBe('12m')
    expect(formatElapsed(65 * 60_000)).toBe('1h 05m')
  })
})

describe('where the minis stand', () => {
  const [ax, , az] = STATION.avatar

  it('a semicircle about 2 m behind the parent, centred on its back', () => {
    const { seats, overflow } = miniSeats(3)
    expect(overflow).toBe(0)
    for (const seat of seats) {
      expect(seat.z).toBeLessThan(az - 0.5) // behind (station-local -Z, away from the plaza)
      expect(Math.hypot(seat.x - ax, seat.z - az)).toBeCloseTo(2.0, 5)
    }
    expect(seats[1].x).toBeCloseTo(ax) // the middle one straight behind
    expect(seats[0].x).toBeCloseTo(-seats[2].x)
    for (let i = 1; i < seats.length; i += 1) expect(Math.hypot(seats[i].x - seats[i - 1].x, seats[i].z - seats[i - 1].z)).toBeGreaterThan(0.8)
  })

  it('a second row past six, then a "+N" sign', () => {
    const six = miniSeats(6)
    expect(six.seats.every(seat => seat.row === 0)).toBe(true)
    const many = miniSeats(20)
    const capacity = MINI_ROW_SIZES.reduce((a, b) => a + b, 0)
    expect(many.seats).toHaveLength(capacity)
    expect(many.seats.filter(seat => seat.row === 1)).toHaveLength(MINI_ROW_SIZES[1])
    expect(many.overflow).toBe(20 - capacity)
    expect(many.overflowAt?.z).toBeLessThan(Math.min(...many.seats.map(seat => seat.z)))
    expect(miniSeats(0)).toEqual({ seats: [], overflow: 0, overflowAt: null })
  })
})

describe('an agent whose helpers work', () => {
  const base = { status: 'waiting' as const, unseen: true, decisions: [], lastEventAt: 5000 }

  it('is violet "helpers working (n)" while its own turn is over, and does not ask for you yet', () => {
    const agent = { ...base, subagents: [sub('a'), sub('b'), sub('c', { status: 'completed', endedAt: 4000 })] }
    expect(runningSubagentCount(agent)).toBe(2)
    expect(villageAgentLook(agent)).toEqual({ status: 'helpers', color: VILLAGE_HELPERS_COLOR, label: 'helpers working (2)', helpers: 2 })
    expect(attentionRank(agent)).toBeNull()
    expect(attentionRank({ ...agent, subagents: [] })).toBe(2)
  })

  it('keeps its own colour while it works itself or needs a decision', () => {
    expect(villageAgentLook({ ...base, status: 'working', subagents: [sub('a')] })).toMatchObject({ status: 'working', helpers: 1 })
    expect(villageAgentLook({ ...base, status: 'needs-decision', subagents: [sub('a')] }).status).toBe('needs-decision')
    expect(attentionRank({ ...base, status: 'needs-decision', subagents: [sub('a')] })).toBe(0)
  })
})

describe('the store follows helpers', () => {
  const event = (kind: string, fields: Record<string, unknown>, ts: number) => ({ v: 1, agentId: 'agent-1', ts, kind, ...fields }) as EngineEvent
  const apply = (events: EngineEvent[]) => events.reduce((state, e) => agentEngineReducer(state, { type: 'event', event: e }), createInitialAgentEngineState())

  it('a finished agent asks for you only once its last helper is done', () => {
    let state = apply([
      event('status', { status: 'working' }, 1000),
      event('subagent.start', { toolUseId: 'toolu_A', description: 'skies' }, 1100),
      event('turn.end', { outcome: 'done-waiting', reason: 'end_turn' }, 1200),
      event('status', { status: 'waiting' }, 1201),
    ])
    expect(state.agents['agent-1'].attentionSince).toBeNull()
    state = agentEngineReducer(state, { type: 'event', event: event('subagent.end', { toolUseId: 'toolu_A', status: 'completed' }, 2000) })
    expect(state.agents['agent-1'].attentionSince).toBe(2000)
  })

  it('a resumed helper runs again under its old entry', () => {
    const state = apply([
      event('subagent.start', { toolUseId: 'toolu_A', description: 'skies' }, 1000),
      event('subagent.end', { toolUseId: 'toolu_A', status: 'completed', summary: 'done' }, 2000),
      event('subagent.start', { toolUseId: 'toolu_A', description: 'skies', resumed: true }, 3000),
    ])
    const [helper] = state.agents['agent-1'].subagents
    expect(state.agents['agent-1'].subagents).toHaveLength(1)
    expect(helper).toMatchObject({ key: 'toolu_A', status: 'running', startedAt: 3000 })
    expect(helper.endedAt).toBeUndefined()
    expect(state.agents['agent-1'].log.find(entry => entry.key === 's:toolu_A')).toMatchObject({ status: 'running' })
  })
})
