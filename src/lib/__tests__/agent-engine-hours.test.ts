import { describe, expect, it } from 'vitest'
import { AgentHours, ownTurnMs } from '../../../packages/oasis-agent-engine/src/agent-hours.js'

type Sent = { url: string; body: { agentWork: Array<Record<string, unknown>>; source: string } }

function rig(fail = 0) {
  const sent: Sent[] = []
  let failures = fail
  const hours = new AgentHours({
    webUrl: 'http://oasis.test',
    flushMs: 0,
    heartbeatMs: 1e9,
    fetch: (async (url: string, init: { body: string }) => {
      if (failures > 0) { failures -= 1; throw new Error('offline') }
      sent.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch,
  })
  return { hours, sent }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
const agent = { id: 'agent-1', sessionId: 'sess-1', name: 'Anorakdev' }

describe('the engine books agent hours itself', () => {
  it('own time is the turn minus waiting on helpers; helpers count in full under the parent', async () => {
    const { hours, sent } = rig()
    hours.onEvent({ kind: 'subagent.start', agentId: 'agent-1', ts: 500_000, toolUseId: 'h1' }, agent)
    hours.onEvent({ kind: 'subagent.start', agentId: 'agent-1', ts: 650_000, toolUseId: 'h2' }, agent)
    hours.onEvent({ kind: 'subagent.end', agentId: 'agent-1', ts: 700_000, toolUseId: 'h1' }, agent)
    hours.onEvent({ kind: 'subagent.end', agentId: 'agent-1', ts: 800_000, taskId: 'x', toolUseId: 'h2' }, agent)
    hours.onEvent({ kind: 'turn.end', agentId: 'agent-1', ts: 1_000_000, durationMs: 600_000 }, agent)
    hours.onEvent({ kind: 'text.delta', agentId: 'agent-1', ts: 1 }, agent)
    hours.onEvent({ kind: 'turn.end', agentId: 'agent-1', ts: 1_000_001 }, agent) // no duration: nothing
    await settle()
    const reports = sent.flatMap(s => s.body.agentWork)
    expect(sent[0]).toMatchObject({ url: 'http://oasis.test/api/village/work', body: { source: 'engine' } })
    expect(reports).toEqual([
      { key: 'sess-1', name: 'Anorakdev', ts: 700_000, kind: 'helper', ms: 200_000 },
      { key: 'sess-1', name: 'Anorakdev', ts: 800_000, kind: 'helper', ms: 150_000 },
      { key: 'sess-1', name: 'Anorakdev', ts: 1_000_000, kind: 'turn', ms: 300_000 },
    ])
    expect(ownTurnMs(600_000, 1_000_000, [])).toBe(600_000)
  })
  it('a report that fails is kept and sent with the next (retried after 30 s, or with the next flush)', async () => {
    const { hours, sent } = rig(1)
    hours.onEvent({ kind: 'turn.end', agentId: 'agent-1', ts: 10_000, durationMs: 5000 }, agent)
    await settle()
    expect(sent).toHaveLength(0)
    hours.onEvent({ kind: 'turn.end', agentId: 'agent-1', ts: 20_000, durationMs: 4000 }, agent)
    await hours.flush(false)
    hours.stop()
    expect(sent.flatMap(s => s.body.agentWork).map(r => r.ms)).toEqual([5000, 4000])
  })
  it('a heartbeat tells the Oasis the engine books, and then pages stop relaying', async () => {
    const { hours, sent } = rig()
    await hours.flush(true)
    expect(sent[0].body).toEqual({ agentWork: [], source: 'engine' })
    const { emptyWorkFile, workSnapshot } = await import('../village/work-vow')
    const book = { ...emptyWorkFile(), engineReportAt: Date.parse('2026-11-20T12:00:00Z') }
    expect(workSnapshot(book, Date.parse('2026-11-20T12:10:00Z'), 60).agentHoursFrom).toBe('engine')
    expect(workSnapshot(book, Date.parse('2026-11-20T12:20:00Z'), 60).agentHoursFrom).toBe('page')
  })
})
