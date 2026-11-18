// Schedules (engine schedule.js): slots, quiet hours, the cap, missed slots collapsing, appointments, the message,
// and the Scheduler against fake agents and a fake clock. Plus the agent's side (agent.js): one scheduled message
// at a time, marked, no eyes picture, and the turn it starts is the schedule's.
import { describe, expect, it } from 'vitest'
import * as scheduleModule from '../../../packages/oasis-agent-engine/src/schedule.js'
import * as agentModule from '../../../packages/oasis-agent-engine/src/agent.js'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'
import * as voiceModule from '../../../packages/oasis-agent-engine/src/voice.js'

type Schedule = { every: string; at: string; day?: number; prompt: string | null; since: number }
type Appointment = { id: string; at: number; repeat: string | null; note: string; prompt: string | null; by: string | null }
type Settings = { quiet: { from: string; to: string } | null; dailyCap: number }
const S = scheduleModule as unknown as {
  DEFAULT_PROMPT: string
  DEFAULT_SETTINGS: Settings
  parseClock: (v: unknown) => string | null
  normalizeSchedule: (v: unknown, now?: number) => Schedule | null
  normalizeSettings: (v: unknown) => Settings
  isQuiet: (ms: number, q: Settings['quiet']) => boolean
  slotsBetween: (s: Schedule, from: number, to: number) => number[]
  nextSlot: (s: Schedule, after: number, q: Settings['quiet']) => number | null
  describeSchedule: (s: Schedule | null) => string
  parseWhen: (v: unknown, now?: number) => number | null
  nextRepeat: (a: Appointment, now: number) => number | null
  normalizeAppointment: (v: unknown, now?: number) => Appointment
  nextWake: (a: { schedule: Schedule | null; appointments?: Appointment[]; wake?: { lastAt?: number | null } }, settings: Settings, now: number) => { at: number; label: string } | null
  dueFor: (a: { schedule: Schedule | null; appointments?: Appointment[]; wake?: { lastAt?: number | null } }, settings: Settings, now: number) => { recurring: number | null; appointments: Appointment[]; stale: Appointment[] }
  wakeMessage: (o: { schedule: Schedule | null; recurring: number | null; appointments: Appointment[] }, now: number, opts?: { tell?: string }) => { note: string; text: string; label: string }
  SCHEDULE_NOTE: RegExp
  scheduleSettingsFileFor: (f: string) => string
  Scheduler: new (o: Record<string, unknown>) => {
    settings: Settings
    start: (o?: { delayMs?: number }) => void
    stop: () => void
    check: (agent: FakeAgent, now?: number) => string | null
    tick: () => void
    countToday: (agent: FakeAgent, now?: number) => number
    setSettings: (patch: Partial<Settings>) => Settings
  }
}
const { ENGINE_NOTE } = voiceModule as unknown as { ENGINE_NOTE: RegExp }

/** Local time, the way the engine reads schedules. */
const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m).getTime()
const WED = at(2026, 11, 18, 12, 0) // Wednesday 18 Nov 2026, 12:00
const NO_QUIET: Settings = { quiet: null, dailyCap: 8 }
const QUIET: Settings = { quiet: { from: '01:00', to: '08:00' }, dailyCap: 8 }
const sched = (every: string, extra: Partial<Schedule> = {}) => S.normalizeSchedule({ every, ...extra }, extra.since ?? at(2026, 11, 1, 0, 0))!

describe('schedule: slots and clocks', () => {
  it('reads times of day and keeps what it may store', () => {
    expect(S.parseClock('9:5')).toBeNull()
    expect(S.parseClock('9:05')).toBe('09:05')
    expect(S.parseClock('16')).toBe('16:00')
    expect(S.parseClock('24:00')).toBeNull()
    expect(S.normalizeSchedule({ every: 'off' })).toBeNull()
    expect(S.normalizeSchedule({ every: 'off', prompt: ' mine ' })).toEqual({ every: 'off', prompt: 'mine' }) // switching back on keeps it
    expect(S.normalizeSchedule({ every: 'sometimes' })).toBeNull()
    expect(S.normalizeSchedule({ every: 'daily' }, 5)).toEqual({ every: 'daily', at: '09:00', prompt: null, since: 5 })
    expect(S.normalizeSchedule({ every: 'weekly', at: '16:20', day: 3 }, 5)).toMatchObject({ every: 'weekly', at: '16:20', day: 3 })
    expect(S.normalizeSchedule({ every: '3h' }, 5)).toMatchObject({ at: '00:00' })
    expect(S.normalizeSettings(undefined)).toEqual(S.DEFAULT_SETTINGS)
    expect(S.normalizeSettings({ quiet: null, dailyCap: 3 })).toEqual({ quiet: null, dailyCap: 3 })
    expect(S.normalizeSettings({ dailyCap: -1 }).dailyCap).toBe(8)
    expect(S.scheduleSettingsFileFor('data/agent-engine.local.json').replace(/\\/g, '/')).toBe('data/agent-engine.schedule.local.json')
  })

  it('quiet hours, also across midnight', () => {
    const q = { from: '01:00', to: '08:00' }
    expect(S.isQuiet(at(2026, 11, 18, 0, 59), q)).toBe(false)
    expect(S.isQuiet(at(2026, 11, 18, 1, 0), q)).toBe(true)
    expect(S.isQuiet(at(2026, 11, 18, 7, 59), q)).toBe(true)
    expect(S.isQuiet(at(2026, 11, 18, 8, 0), q)).toBe(false)
    const night = { from: '22:00', to: '06:00' }
    expect(S.isQuiet(at(2026, 11, 18, 23, 0), night)).toBe(true)
    expect(S.isQuiet(at(2026, 11, 18, 5, 0), night)).toBe(true)
    expect(S.isQuiet(at(2026, 11, 18, 12, 0), night)).toBe(false)
    expect(S.isQuiet(WED, null)).toBe(false)
  })

  it('hourly, every 3 and 6 hours, daily and weekly slots', () => {
    expect(S.slotsBetween(sched('hourly'), at(2026, 11, 18, 9, 30), at(2026, 11, 18, 12, 0))).toEqual([at(2026, 11, 18, 10), at(2026, 11, 18, 11), at(2026, 11, 18, 12)])
    expect(S.slotsBetween(sched('3h', { at: '01:30' }), at(2026, 11, 18, 0), at(2026, 11, 18, 23, 59))).toEqual([1, 4, 7, 10, 13, 16, 19, 22].map(h => at(2026, 11, 18, h, 30)))
    expect(S.slotsBetween(sched('6h'), at(2026, 11, 18, 0), at(2026, 11, 19, 0))).toEqual([at(2026, 11, 18, 6), at(2026, 11, 18, 12), at(2026, 11, 18, 18), at(2026, 11, 19, 0)])
    expect(S.slotsBetween(sched('daily', { at: '09:00' }), at(2026, 11, 18, 9, 0), at(2026, 11, 20, 9, 0))).toEqual([at(2026, 11, 19, 9), at(2026, 11, 20, 9)])
    expect(S.slotsBetween(sched('weekly', { at: '16:20', day: 3 }), at(2026, 11, 10), at(2026, 11, 30))).toEqual([at(2026, 11, 11, 16, 20), at(2026, 11, 18, 16, 20), at(2026, 11, 25, 16, 20)])
    expect(S.describeSchedule(sched('weekly', { at: '16:20', day: 3 }))).toBe('weekly on Wednesday at 16:20')
    expect(S.describeSchedule(sched('3h', { at: '01:30' }))).toBe('every 3 hours from 01:30')
    expect(S.describeSchedule(null)).toBe('off')
  })

  it('the next wake-up skips the quiet hours', () => {
    expect(S.nextSlot(sched('hourly'), at(2026, 11, 18, 0, 30), QUIET.quiet)).toBe(at(2026, 11, 18, 8))
    expect(S.nextSlot(sched('daily', { at: '03:00' }), WED, QUIET.quiet)).toBeNull() // always quiet: never
    expect(S.nextWake({ schedule: sched('daily', { at: '09:00' }) }, QUIET, WED)).toEqual({ at: at(2026, 11, 19, 9), label: 'daily at 09:00' })
  })

  it('reads the times people and agents give', () => {
    expect(S.parseWhen('16:20', WED)).toBe(at(2026, 11, 18, 16, 20))
    expect(S.parseWhen('11:00', WED)).toBe(at(2026, 11, 19, 11, 0)) // passed today: tomorrow
    expect(S.parseWhen('wed 16:20', WED)).toBe(at(2026, 11, 18, 16, 20))
    expect(S.parseWhen('Wednesday 11:00', WED)).toBe(at(2026, 11, 25, 11, 0))
    expect(S.parseWhen('tomorrow 9:00', WED)).toBe(at(2026, 11, 19, 9, 0))
    expect(S.parseWhen('2026-11-25 16:20', WED)).toBe(at(2026, 11, 25, 16, 20))
    expect(S.parseWhen('in 30m', WED)).toBe(WED + 30 * 60_000)
    expect(S.parseWhen('in 2h', WED)).toBe(WED + 2 * 3600_000)
    expect(S.parseWhen(WED + 5, WED)).toBe(WED + 5)
    expect(S.parseWhen('soonish', WED)).toBeNull()
    expect(() => S.normalizeAppointment({ at: 'soonish', note: 'x' }, WED)).toThrow(/at:/)
    expect(() => S.normalizeAppointment({ at: '16:20' }, WED)).toThrow(/note/)
  })

  it('a repeating appointment moves on by calendar days', () => {
    const council = S.normalizeAppointment({ at: 'wed 16:20', repeat: 'weekly', note: 'The Council' }, WED)
    expect(S.nextRepeat(council, at(2026, 11, 18, 16, 21))).toBe(at(2026, 11, 25, 16, 20))
    // Missed for weeks: its next time after now, not the slots in between.
    expect(S.nextRepeat(council, at(2026, 12, 10, 12))).toBe(at(2026, 12, 16, 16, 20))
    expect(S.nextRepeat({ ...council, repeat: null }, WED)).toBeNull()
  })
})

describe('schedule: what is due', () => {
  it('missed slots collapse into one wake-up', () => {
    // Hourly, last woke at 09:00, the engine was off until 12:30: one wake-up, for the 12:00 slot.
    const due = S.dueFor({ schedule: sched('hourly'), wake: { lastAt: at(2026, 11, 18, 9, 0) } }, NO_QUIET, at(2026, 11, 18, 12, 30))
    expect(due.recurring).toBe(at(2026, 11, 18, 12))
    // Daily, the engine off for three days: one.
    const daily = S.dueFor({ schedule: sched('daily', { at: '09:00' }), wake: { lastAt: at(2026, 11, 15, 9, 1) } }, NO_QUIET, at(2026, 11, 18, 12))
    expect(daily.recurring).toBe(at(2026, 11, 18, 9))
    expect(S.dueFor({ schedule: sched('hourly'), wake: { lastAt: at(2026, 11, 18, 12, 0) } }, NO_QUIET, at(2026, 11, 18, 12, 30)).recurring).toBeNull()
  })

  it('no slot before the schedule was set, none in quiet hours, none while it is quiet', () => {
    expect(S.dueFor({ schedule: sched('daily', { at: '09:00', since: at(2026, 11, 18, 10) }) }, NO_QUIET, at(2026, 11, 18, 11)).recurring).toBeNull()
    // Hourly through the night: at 07:30 nothing, at 08:10 the 08:00 slot (the 01:00-07:00 ones were quiet).
    const night = { schedule: sched('hourly'), wake: { lastAt: at(2026, 11, 18, 0, 0) } }
    expect(S.dueFor(night, QUIET, at(2026, 11, 18, 7, 30)).recurring).toBeNull()
    expect(S.dueFor(night, QUIET, at(2026, 11, 18, 8, 10)).recurring).toBe(at(2026, 11, 18, 8))
    // A 00:00 slot missed while the engine was off, the engine back at 03:00: it waits for the end of the quiet hours.
    const missed = { schedule: sched('daily', { at: '00:00' }), wake: { lastAt: at(2026, 11, 17, 0, 0) } }
    expect(S.dueFor(missed, QUIET, at(2026, 11, 18, 3)).recurring).toBeNull()
    expect(S.dueFor(missed, QUIET, at(2026, 11, 18, 8)).recurring).toBe(at(2026, 11, 18, 0))
  })

  it('appointments are due at their time whatever the quiet hours; a one-off a day late is dropped', () => {
    const night = S.normalizeAppointment({ at: '2026-11-18 03:00', note: 'night job' }, at(2026, 11, 17, 12))
    const old = S.normalizeAppointment({ at: '2026-11-16 16:20', note: 'old' }, at(2026, 11, 15, 12))
    const weekly = S.normalizeAppointment({ at: '2026-11-11 16:20', repeat: 'weekly', note: 'Council' }, at(2026, 11, 10, 12))
    const due = S.dueFor({ schedule: null, appointments: [night, old, weekly] }, QUIET, at(2026, 11, 18, 3, 0))
    expect(due.appointments.map(a => a.note)).toEqual(['night job', 'Council'])
    expect(due.stale.map(a => a.note)).toEqual(['old'])
  })

  it('the message says it comes from the schedule, and the thread hides that note', () => {
    const m = S.wakeMessage({ schedule: sched('daily', { at: '09:00' }), recurring: at(2026, 11, 18, 9), appointments: [] }, at(2026, 11, 18, 9, 0), { tell: 'C:/x/tell.mjs' })
    expect(m.text).toBe(S.DEFAULT_PROMPT)
    expect(m.note).toBe('[Oasis schedule: daily at 09:00 wake-up, 09:00. This message comes from your schedule, not from the owner. To tell the owner on Telegram: node "C:/x/tell.mjs" "<a few lines>".]')
    expect(ENGINE_NOTE.test(m.note)).toBe(true)
    expect(S.SCHEDULE_NOTE.exec(m.note)?.[1]).toMatch(/^daily at 09:00 wake-up/)
    // Late (the engine was off): it says when it was due.
    const late = S.wakeMessage({ schedule: sched('daily', { at: '09:00' }), recurring: at(2026, 11, 18, 9), appointments: [] }, at(2026, 11, 18, 18, 2))
    expect(late.note).toContain('due 09:00 (sent 18:02: the engine was off or you were busy)')
    // An appointment at the same time: its words, not the standing prompt as well.
    const council = S.normalizeAppointment({ at: '16:20', note: 'The Council', by: 'Anorak' }, WED)
    const both = S.wakeMessage({ schedule: sched('hourly', { prompt: 'Mine.' }), recurring: council.at, appointments: [council] }, council.at)
    expect(both.text).toBe('It is time for your appointment: The Council. (Set by Anorak.)')
    expect(both.label).toBe('appointment: The Council (2026-11-18 16:20) + hourly wake-up')
    // Its own prompt replaces the default.
    expect(S.wakeMessage({ schedule: sched('hourly', { prompt: 'Check the build.' }), recurring: WED, appointments: [] }, WED).text).toBe('Check the build.')
  })
})

interface FakeAgent {
  kind: string
  id: string
  name: string
  schedule: Schedule | null
  appointments: Appointment[]
  wake: { lastAt: number | null; day: string | null; count: number }
  scheduledPending: string | null
  idle: boolean
  sent: Array<{ note: string; text: string; label: string }>
  notices: string[]
  isIdle: () => boolean
  wakeUp: (m: { note: string; text: string; label: string }) => Promise<void>
  persist: () => void
  emit: (kind: string, p: { text?: string }) => void
}

function fakeAgent(extra: Partial<FakeAgent> = {}): FakeAgent {
  const a: FakeAgent = {
    kind: 'owned', id: 'agent-1', name: 'Rick', schedule: null, appointments: [], wake: { lastAt: null, day: null, count: 0 },
    scheduledPending: null, idle: true, sent: [], notices: [],
    isIdle: () => a.idle,
    wakeUp: async (m) => { a.sent.push(m); a.scheduledPending = 'u' },
    persist: () => {},
    emit: (_k, p) => { if (p.text) a.notices.push(p.text) },
    ...extra,
  }
  return a
}

describe('the Scheduler (fake clock)', () => {
  function make(agents: FakeAgent[], settings: Settings = NO_QUIET) {
    let t = WED
    const s = new S.Scheduler({ agents: () => agents, now: () => t, settingsFile: null })
    s.settings = settings
    // No timers and no first tick: the test drives it.
    ;(s as unknown as { paused: boolean }).paused = false
    return { s, set: (ms: number) => { t = ms }, now: () => t }
  }

  it('wakes an idle agent once per slot, waits while it is busy, and never queues two', () => {
    const a = fakeAgent({ schedule: sched('hourly') })
    a.wake.lastAt = at(2026, 11, 18, 11, 0)
    const { s, set } = make([a])
    set(at(2026, 11, 18, 12, 0))
    a.idle = false
    expect(s.check(a)).toBe('waiting')
    expect(a.sent).toHaveLength(0)
    a.idle = true
    expect(s.check(a)).toBe('woke')
    expect(a.sent).toHaveLength(1)
    expect(a.wake).toMatchObject({ lastAt: at(2026, 11, 18, 12), count: 1 })
    expect(s.check(a)).toBeNull() // the same slot never twice
    // The next slot comes while the first message is still on its way: it waits for that one.
    set(at(2026, 11, 18, 13, 0))
    expect(s.check(a)).toBe('waiting')
    a.scheduledPending = null
    expect(s.check(a)).toBe('woke')
    expect(a.sent).toHaveLength(2)
  })

  it('the engine was off for hours: one wake-up at start, not one per slot', () => {
    const a = fakeAgent({ schedule: sched('hourly') })
    a.wake.lastAt = at(2026, 11, 18, 3, 0)
    const { s, set } = make([a])
    set(at(2026, 11, 18, 12, 40))
    s.tick()
    a.scheduledPending = null
    s.tick()
    expect(a.sent).toHaveLength(1)
    expect(a.sent[0].note).toContain('due 12:00')
  })

  it('the daily cap stops the recurring wake-ups, never an appointment', () => {
    const a = fakeAgent({ schedule: sched('hourly') })
    const { s, set } = make([a], { quiet: null, dailyCap: 2 })
    for (const h of [9, 10, 11]) {
      set(at(2026, 11, 18, h, 0))
      a.scheduledPending = null
      s.check(a)
    }
    expect(a.sent).toHaveLength(2)
    expect(a.notices.some(n => /daily cap of 2/.test(n))).toBe(true)
    a.appointments = [S.normalizeAppointment({ at: '2026-11-18 16:20', note: 'The Council' }, at(2026, 11, 18, 9))]
    set(at(2026, 11, 18, 16, 20))
    a.scheduledPending = null
    expect(s.check(a)).toBe('woke')
    expect(a.sent[2].text).toContain('The Council')
    expect(a.appointments).toEqual([]) // a one-off is done
    expect(s.countToday(a)).toBe(3)
    // A new day, a new count.
    set(at(2026, 11, 19, 9, 0))
    expect(s.countToday(a)).toBe(0)
  })

  it('a repeating appointment stays, at its next time; a stale one-off is dropped with a notice', () => {
    const council = S.normalizeAppointment({ at: '2026-11-18 16:20', repeat: 'weekly', note: 'The Council' }, WED)
    const stale = S.normalizeAppointment({ at: '2026-11-16 10:00', note: 'gone' }, at(2026, 11, 15))
    const a = fakeAgent({ appointments: [council, stale] })
    const { s, set } = make([a])
    set(at(2026, 11, 18, 16, 21))
    expect(s.check(a)).toBe('woke')
    expect(a.appointments.map(x => x.at)).toEqual([at(2026, 11, 25, 16, 20)])
    expect(a.notices.some(n => /missed by more than a day and dropped/.test(n))).toBe(true)
  })

  it('does nothing before start() (the engine first brings everyone back), and only for agents it runs', () => {
    const a = fakeAgent({ schedule: sched('hourly') })
    const s = new S.Scheduler({ agents: () => [a], now: () => at(2026, 11, 18, 12), settingsFile: null })
    expect(s.check(a)).toBeNull()
    ;(s as unknown as { paused: boolean }).paused = false
    expect(s.check(fakeAgent({ kind: 'observer', schedule: sched('hourly') }))).toBeNull()
  })
})

describe('agent: a scheduled message', () => {
  const { Agent } = agentModule as unknown as { Agent: new (spec: Record<string, unknown>, hub: Record<string, unknown>) => {
    proc: unknown; isIdle: () => boolean; wakeUp: (m: { note: string; text: string; label: string }) => Promise<{ uuid: string }>
    send: (text: string) => Promise<{ uuid: string }>; onLine: (line: string) => void; scheduledPending: string | null; rosterEntry: () => Record<string, unknown>
  } }
  function make(spec: Record<string, unknown> = {}) {
    const written: Array<{ uuid: string; message: { content: unknown } }> = []
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
    let eyesAsked = 0
    const hub = { emit: (_id: string, kind: string, payload: Record<string, unknown>) => events.push({ kind, payload }), persist: () => {}, log: () => {}, eyes: async () => { eyesAsked += 1; return null } }
    const agent = new Agent({ id: 'agent-1', name: 'Anorak', cwd: process.cwd(), speak: false, speakSet: true, voiceOffered: true, ...spec }, hub)
    agent.proc = { pid: 1, stdin: { write: (line: string) => written.push(JSON.parse(line)) } }
    return { agent, written, events, eyesAsked: () => eyesAsked }
  }
  const NOTE = '[Oasis schedule: hourly wake-up, 12:00. This message comes from your schedule, not from the owner.]'

  it('goes out with its note first, no eyes picture, tagged, and one at a time', async () => {
    const { agent, written, events, eyesAsked } = make()
    await agent.wakeUp({ note: NOTE, text: 'Look around.', label: 'hourly wake-up' })
    expect(written[0].message.content).toEqual([{ type: 'text', text: NOTE }, { type: 'text', text: 'Look around.' }])
    expect(eyesAsked()).toBe(0)
    expect(events.find(e => e.kind === 'user.sent')?.payload).toMatchObject({ auto: 'schedule', scheduled: 'hourly wake-up', text: 'Look around.' })
    expect(events.filter(e => e.kind === 'status').pop()?.payload).toMatchObject({ reason: 'woke up on its schedule' })
    expect(agent.isIdle()).toBe(false)
    expect(agent.scheduledPending).toBe(written[0].uuid)
  })

  it('its turn is marked as the schedule\'s, unless the owner joined it', async () => {
    const run = async (ownerJoins: boolean) => {
      const { agent, written, events } = make()
      await agent.wakeUp({ note: NOTE, text: 'Look around.', label: 'hourly wake-up' })
      agent.onLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }))
      agent.onLine(JSON.stringify({ type: 'user', isReplay: true, uuid: written[0].uuid, message: { role: 'user', content: written[0].message.content } }))
      if (ownerJoins) await agent.send('Also: hi.')
      agent.onLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', duration_ms: 1000, usage: {} }))
      return events.find(e => e.kind === 'turn.end')?.payload
    }
    expect(await run(false)).toMatchObject({ scheduled: true })
    expect((await run(true))?.scheduled).toBeUndefined()
  })

  it('keeps its schedule in the roster', () => {
    const { agent } = make({ schedule: { every: 'daily', at: '09:00', since: 5 }, appointments: [{ id: 'appt-1', at: 9, repeat: null, note: 'x' }], wake: { lastAt: 7, day: '2026-11-18', count: 2 } })
    expect(agent.rosterEntry()).toMatchObject({ schedule: { every: 'daily', at: '09:00', since: 5 }, appointments: [{ id: 'appt-1' }], wake: { lastAt: 7, count: 2 } })
    expect(make().agent.rosterEntry().schedule).toBeUndefined()
  })

  it('the thread tags it, also when it comes back from the transcript', () => {
    const { Normalizer } = normalizeModule as unknown as { Normalizer: new (id: string, emit: (k: string, p: Record<string, unknown>) => void, o: { mode: string }) => { handleStream: (m: unknown) => void } }
    const seen: Array<Record<string, unknown>> = []
    const n = new Normalizer('a', (k, p) => { if (k === 'user') seen.push(p) }, { mode: 'live' })
    n.handleStream({ type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: NOTE }, { type: 'text', text: 'Look around.' }] } })
    expect(seen).toEqual([expect.objectContaining({ text: 'Look around.', scheduled: 'hourly wake-up' })])
  })
})
