// Across engine restarts: the journal (journal.js), who is carried on (resume.js), and an agent's leftovers
// (agent.js flushLeftovers). The engine is plain ESM JS; these pieces run without spawning a process.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as journalModule from '../../../packages/oasis-agent-engine/src/journal.js'
import * as resumeModule from '../../../packages/oasis-agent-engine/src/resume.js'
import * as agentModule from '../../../packages/oasis-agent-engine/src/agent.js'
import * as bridgeModule from '../../../packages/oasis-agent-engine/src/bridge.js'

interface Entry { uuid: string; text: string; resume?: boolean; source?: string; at?: number }
interface JournalLike {
  previous: unknown
  load: (o?: { pid?: number }) => unknown
  previousStop: () => { at: number; planned: boolean; reason: string | null } | null
  stop: (o?: { planned?: boolean; reason?: string | null }) => void
  queue: (agentId: string, entry: Entry, o?: { first?: boolean }) => void
  done: (agentId: string, uuid: string) => void
  queuedFor: (agentId: string) => Entry[]
  forget: (agentId: string) => void
  hasSource: (source: string) => boolean
  agentsWithSource: (prefix: string) => string[]
  setBridge: (inboxes: Record<string, Array<{ text: string; at: number }>>) => void
  bridgeInboxes: () => Record<string, Array<{ text: string; at: number }>>
  telegramTook: (u: { update_id: number }) => void
  telegramHandled: (id: number) => void
  telegramLeft: () => Array<{ update_id: number; tries?: number }>
  setOwed: (ids: string[]) => void
  owed: () => string[]
}
const { Journal, journalFileFor } = journalModule as unknown as {
  Journal: new (file: string | null, o?: { now?: () => number }) => JournalLike
  journalFileFor: (rosterFile: string) => string
}
const { RESUME_TEXT, RESUMED_REASON, transcriptTurnOpen, wasMidTurn, restartLine } = resumeModule as unknown as {
  RESUME_TEXT: string
  RESUMED_REASON: string
  transcriptTurnOpen: (lines: string[]) => boolean | null
  wasMidTurn: (entry: { turnOpenAt?: number }, open: boolean | null, stop: { planned: boolean } | null) => boolean
  restartLine: (info: { startedAt: number; stop: { at: number; planned: boolean } | null; resumed: unknown[]; redelivered: number }) => string | null
}
interface AgentLike {
  proc: unknown
  turnRunning: boolean
  status: string
  statusReason: string
  resumedAt: number | null
  inFlight: Set<string>
  send: (text: string, o?: Record<string, unknown>) => Promise<{ uuid: string }>
  flushLeftovers: (o?: { resume?: boolean }) => Promise<{ resumed: boolean; delivered: number }>
  transcriptTail: () => string
  untilTurnRuns: (ms?: number) => Promise<void>
  onLine: (line: string) => void
  snapshot: () => { resumedAt: number | null }
  rosterEntry: () => { pid?: number }
}
const { Agent } = agentModule as unknown as { Agent: new (spec: Record<string, unknown>, hub: Record<string, unknown>) => AgentLike }
const { restoreInboxes, checkIn, dumpInboxes } = bridgeModule as unknown as {
  restoreInboxes: (inboxes: Record<string, Array<{ text: string; at?: number }>>, now?: number) => number
  checkIn: (o: { sessionId: string }) => { messages: Array<{ text: string }> }
  dumpInboxes: () => Record<string, unknown>
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-resume-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const file = () => path.join(dir, `journal-${++n}.json`)

describe('journal', () => {
  it('sits next to the roster', () => {
    expect(journalFileFor(path.join('data', 'agent-engine.local.json'))).toBe(path.join('data', 'agent-engine.journal.local.json'))
    expect(journalFileFor(path.join('tmp', 'roster.json'))).toBe(path.join('tmp', 'roster.journal.json'))
  })

  it('keeps queued messages in order across a restart, and crosses off what was taken in', () => {
    const f = file()
    const a = new Journal(f)
    a.load()
    a.queue('agent-1', { uuid: 'u1', text: 'first' })
    a.queue('agent-1', { uuid: 'u2', text: 'second', source: 'tg:7' })
    a.queue('agent-1', { uuid: 'u2', text: 'second again' }) // the same uuid is one message
    a.queue('agent-2', { uuid: 'u3', text: 'other' })
    a.done('agent-2', 'u3')
    const b = new Journal(f)
    b.load()
    expect(b.queuedFor('agent-1').map(e => e.text)).toEqual(['first', 'second'])
    expect(b.queuedFor('agent-2')).toEqual([])
    expect(b.hasSource('tg:7')).toBe(true)
    expect(b.agentsWithSource('tg:')).toEqual(['agent-1'])
    b.queue('agent-1', { uuid: 'r', text: RESUME_TEXT, resume: true }, { first: true })
    expect(b.queuedFor('agent-1').map(e => e.uuid)).toEqual(['r', 'u1', 'u2'])
    b.forget('agent-1')
    expect(new Journal(f).load()).toMatchObject({ queued: {} })
  })

  it('knows a planned stop from an unplanned one, and when', () => {
    let t = 1000
    const f = file()
    const first = new Journal(f, { now: () => t })
    first.load()
    expect(first.previousStop()).toBeNull() // nothing came before
    t = 5000
    first.stop({ planned: true, reason: 'SIGINT' })
    const second = new Journal(f, { now: () => t })
    second.load()
    expect(second.previousStop()).toEqual({ at: 5000, planned: true, reason: 'SIGINT' })
    // The second run never says goodbye: its last sign of life dates the stop.
    t = 9000
    const third = new Journal(f, { now: () => t })
    third.load()
    expect(third.previousStop()).toEqual({ at: 5000, planned: false, reason: null })
  })

  it('a broken or missing file is an empty journal, and no file means nothing is kept', () => {
    const f = file()
    fs.writeFileSync(f, '{ not json')
    const j = new Journal(f)
    expect(j.load()).toBeNull()
    expect(j.queuedFor('x')).toEqual([])
    const none = new Journal(null)
    none.load()
    none.queue('a', { uuid: 'u', text: 't' })
    expect(none.queuedFor('a')).toHaveLength(1) // in memory for this run only
  })

  it('keeps Telegram updates until handled, gives up after two starts, and remembers who owes a reply', () => {
    const f = file()
    const a = new Journal(f)
    a.load()
    a.telegramTook({ update_id: 11 })
    a.telegramTook({ update_id: 12 })
    a.telegramHandled(11)
    a.setOwed(['agent-2', 'agent-1', 'agent-1'])
    const b = new Journal(f)
    b.load()
    expect(b.owed()).toEqual(['agent-1', 'agent-2'])
    expect(b.telegramLeft().map(u => [u.update_id, u.tries])).toEqual([[12, 0]])
    const c = new Journal(f)
    c.load()
    expect(c.telegramLeft().map(u => [u.update_id, u.tries])).toEqual([[12, 1]])
    const d = new Journal(f)
    d.load()
    expect(d.telegramLeft()[0].tries).toBe(2) // telegram.js gives up on it at 2
  })

  it('bridge inboxes wait again after a restart', () => {
    const f = file()
    const a = new Journal(f)
    a.load()
    const sid = '11111111-2222-4333-8444-555555555555'
    a.setBridge({ [sid]: [{ text: 'hello desk', at: 1 }], 'not-a-session': [{ text: 'x', at: 1 }] })
    const b = new Journal(f)
    b.load()
    expect(restoreInboxes(b.bridgeInboxes())).toBe(1)
    expect(checkIn({ sessionId: sid }).messages).toEqual([{ text: 'hello desk' }])
    expect(dumpInboxes()).toEqual({})
  })
})

describe('resume: was the turn cut off?', () => {
  const rec = (o: Record<string, unknown>) => JSON.stringify(o)
  const assistant = (stop: string | null, extra: Record<string, unknown> = {}) => rec({ type: 'assistant', message: { stop_reason: stop, content: [] }, ...extra })
  const toolResult = rec({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })

  it('reads the end of a transcript', () => {
    // Cut while a tool ran (what a killed engine leaves, 2.1.323): the tool_use, then bookkeeping records.
    expect(transcriptTurnOpen([assistant('tool_use'), rec({ type: 'queue-operation', operation: 'enqueue' })])).toBe(true)
    expect(transcriptTurnOpen([assistant('tool_use'), toolResult, rec({ type: 'attachment' })])).toBe(true)
    expect(transcriptTurnOpen([rec({ type: 'user', message: { content: 'do the thing' } })])).toBe(true)
    // Ended.
    expect(transcriptTurnOpen([assistant('tool_use'), toolResult, assistant('end_turn')])).toBe(false)
    expect(transcriptTurnOpen([assistant('end_turn'), rec({ type: 'system', subtype: 'stop_hook_summary' }), rec({ type: 'last-prompt' })])).toBe(false)
    expect(transcriptTurnOpen([assistant('tool_use'), rec({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } })])).toBe(false)
    // A subagent's records and slash-command echoes do not decide.
    expect(transcriptTurnOpen([assistant('end_turn'), assistant('tool_use', { isSidechain: true })])).toBe(false)
    expect(transcriptTurnOpen([assistant('end_turn'), rec({ type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } })])).toBe(false)
    expect(transcriptTurnOpen(['', 'half a li', rec({ type: 'summary' })])).toBeNull()
  })

  it('decides who is carried on', () => {
    const planned = { planned: true }
    const crash = { planned: false }
    // The roster says mid-turn: yes, unless the transcript shows the turn still ended.
    expect(wasMidTurn({ turnOpenAt: 5 }, true, planned)).toBe(true)
    expect(wasMidTurn({ turnOpenAt: 5 }, null, planned)).toBe(true)
    expect(wasMidTurn({ turnOpenAt: 5 }, false, planned)).toBe(false)
    // The roster says nothing: only after an unplanned stop, and only when the transcript is plainly open.
    expect(wasMidTurn({}, true, crash)).toBe(true)
    expect(wasMidTurn({}, null, crash)).toBe(false)
    expect(wasMidTurn({}, true, planned)).toBe(false)
    expect(wasMidTurn({}, true, null)).toBe(false)
  })

  it('writes the line for /health and the HUD', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 16, h, m, 0).getTime()
    expect(restartLine({ startedAt: at(18, 2), stop: null, resumed: [], redelivered: 0 })).toBeNull()
    expect(restartLine({ startedAt: at(18, 2), stop: { at: at(18, 1), planned: true }, resumed: [{}], redelivered: 0 })).toBe('restarted at 18:02, 1 agent resumed')
    expect(restartLine({ startedAt: at(18, 2), stop: { at: at(18, 1), planned: true }, resumed: [], redelivered: 0 })).toBe('restarted at 18:02, nobody was mid-turn')
    expect(restartLine({ startedAt: at(21, 39), stop: { at: at(19, 9), planned: true }, resumed: [{}, {}], redelivered: 3 })).toBe('restarted at 21:39 (down 2.5 h), 2 agents resumed, 3 queued messages delivered')
    expect(restartLine({ startedAt: at(9, 5), stop: { at: at(3, 30), planned: false }, resumed: [], redelivered: 1 })).toBe('restarted at 09:05 after an unplanned stop around 03:30, nobody was mid-turn, 1 queued message delivered')
  })
})

describe('agent: leftovers after a restart', () => {
  function makeAgent(journal: JournalLike, { tail = '', stopping = false } = {}) {
    const written: Array<{ uuid: string; message: { content: unknown } }> = []
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
    const hub = { emit: (_id: string, kind: string, payload: Record<string, unknown>) => events.push({ kind, payload }), persist: () => {}, log: () => {}, journal, stopping: () => stopping }
    const agent = new Agent({ id: 'agent-1', name: 'Rick', cwd: process.cwd(), speak: false, speakSet: true, voiceOffered: true }, hub)
    agent.proc = { pid: 4242, stdin: { write: (line: string) => written.push(JSON.parse(line)) } }
    agent.transcriptTail = () => tail
    agent.untilTurnRuns = async () => {}
    return { agent, written, events }
  }
  const fresh = () => { const j = new Journal(file()); j.load(); return j }

  it('a message is in the journal from send until the CLI echoes it', async () => {
    const journal = fresh()
    const { agent, written } = makeAgent(journal)
    const { uuid } = await agent.send('hello', { source: 'tg:5' })
    expect(journal.queuedFor('agent-1')).toMatchObject([{ uuid, text: 'hello', source: 'tg:5' }])
    expect(written[0].uuid).toBe(uuid)
    agent.onLine(JSON.stringify({ type: 'user', isReplay: true, uuid, message: { role: 'user', content: 'hello' } }))
    expect(journal.queuedFor('agent-1')).toEqual([])
    expect(agent.rosterEntry().pid).toBe(4242)
  })

  it('a send that fails is the sender\'s again, unless the engine is closing', async () => {
    const journal = fresh()
    const failing = makeAgent(journal)
    ;(failing.agent.proc as { stdin: { write: () => void } }).stdin.write = () => { throw new Error('pipe closed') }
    await expect(failing.agent.send('lost?')).rejects.toThrow('pipe closed')
    expect(journal.queuedFor('agent-1')).toEqual([])
    const closing = makeAgent(journal, { stopping: true })
    ;(closing.agent.proc as { stdin: { write: () => void } }).stdin.write = () => { throw new Error('pipe closed') }
    await expect(closing.agent.send('kept')).rejects.toThrow('pipe closed')
    expect(journal.queuedFor('agent-1').map(e => e.text)).toEqual(['kept'])
  })

  it('carries on first, then what was queued, in order and under the old uuids', async () => {
    const journal = fresh()
    journal.queue('agent-1', { uuid: 'q1', text: 'queued one' })
    journal.queue('agent-1', { uuid: 'q2', text: 'queued two' })
    const { agent, written, events } = makeAgent(journal)
    const done = await agent.flushLeftovers({ resume: true })
    expect(done).toEqual({ resumed: true, delivered: 2 })
    expect(written.map(m => m.message.content)).toEqual([RESUME_TEXT, 'queued one', 'queued two'])
    expect(written.slice(1).map(m => m.uuid)).toEqual(['q1', 'q2'])
    expect(events.find(e => e.kind === 'user.sent')?.payload).toMatchObject({ text: RESUME_TEXT, auto: 'resume' })
    expect(agent.statusReason).toBe(RESUMED_REASON)
    expect(typeof agent.snapshot().resumedAt).toBe('number')
    // Still in the journal until echoed: a second restart now would send these same three, not more.
    expect(journal.queuedFor('agent-1')).toHaveLength(3)
    const again = makeAgent(journal)
    await again.agent.flushLeftovers({ resume: true })
    expect(again.written.map(m => m.uuid)).toEqual(written.map(m => m.uuid))
  })

  it('skips what the transcript already has, and gives a new note when the old one was taken in', async () => {
    const journal = fresh()
    journal.queue('agent-1', { uuid: 'old-note', text: RESUME_TEXT, resume: true })
    journal.queue('agent-1', { uuid: 'q1', text: 'already taken' })
    journal.queue('agent-1', { uuid: 'q2', text: 'never taken' })
    const { agent, written } = makeAgent(journal, { tail: '{"type":"user","uuid":"old-note"}\n{"type":"user","uuid":"q1"}' })
    const done = await agent.flushLeftovers({ resume: true })
    expect(done).toEqual({ resumed: true, delivered: 1 })
    expect(written.map(m => m.message.content)).toEqual([RESUME_TEXT, 'never taken'])
    expect(written[0].uuid).not.toBe('old-note')
  })

  it('does nothing without leftovers, and leaves a message alone that is on its way right now', async () => {
    const journal = fresh()
    const { agent, written } = makeAgent(journal)
    expect(await agent.flushLeftovers()).toEqual({ resumed: false, delivered: 0 })
    journal.queue('agent-1', { uuid: 'busy', text: 'being sent' })
    agent.inFlight.add('busy')
    expect(await agent.flushLeftovers()).toEqual({ resumed: false, delivered: 0 })
    expect(written).toEqual([])
  })

  it('the resumed mark goes when that turn ends', async () => {
    const journal = fresh()
    const { agent } = makeAgent(journal)
    await agent.flushLeftovers({ resume: true })
    expect(agent.resumedAt).not.toBeNull()
    agent.onLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }))
    agent.onLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }))
    expect(agent.resumedAt).toBeNull()
  })
})
