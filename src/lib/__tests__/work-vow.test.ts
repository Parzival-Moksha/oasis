import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activeMsBetween,
  applyWorkBeat,
  daySeconds,
  dayXp,
  emptyWorkFile,
  formatClock,
  localDay,
  localMidnight,
  parseWorkFile,
  releaseWorkHolder,
  setWorkMission,
  workSnapshot,
  xpFor,
  WORK_HOLDER_STALE_MS,
  WORK_IDLE_MS,
  type WorkFile,
} from '../village/work-vow'

// Vienna in November: UTC+1.
const TZ = 60
/** Local wall time on 2026-11-16 as a UTC ms. */
const at = (time: string, date = '2026-11-16') => Date.parse(`${date}T${time}Z`) - TZ * 60_000

/** A tab reporting `seconds` every `every` seconds, starting from a claimed book. */
function run(file: WorkFile, tab: string, start: number, reports: number, seconds = 15, every = 15, seqFrom = 1): WorkFile {
  let book = applyWorkBeat(file, { tab, seq: seqFrom, seconds: 0 }, start, TZ).file
  for (let i = 1; i <= reports; i += 1) book = applyWorkBeat(book, { tab, seq: seqFrom + i, seconds }, start + i * every * 1000, TZ).file
  return book
}

describe('the idle cutoff', () => {
  it('counts while the tab is visible and the last input is under three minutes old', () => {
    expect(activeMsBetween(0, 1000, 0, true)).toBe(1000)
    expect(activeMsBetween(100_000, 101_000, 0, true)).toBe(1000)
    // The slice that straddles the cutoff counts up to the cutoff.
    expect(activeMsBetween(WORK_IDLE_MS - 400, WORK_IDLE_MS + 600, 0, true)).toBe(400)
    expect(activeMsBetween(WORK_IDLE_MS + 1, WORK_IDLE_MS + 1001, 0, true)).toBe(0)
  })
  it('counts nothing while hidden, or before any input', () => {
    expect(activeMsBetween(0, 1000, 0, false)).toBe(0)
    expect(activeMsBetween(0, 1000, null, true)).toBe(0)
    expect(activeMsBetween(1000, 1000, 0, true)).toBe(0)
  })
})

describe('local days', () => {
  it('the day turns at local midnight, not UTC midnight', () => {
    expect(localDay(at('23:59:59'), TZ)).toBe('2026-11-16')
    expect(localDay(at('00:00:00', '2026-11-17'), TZ)).toBe('2026-11-17')
    // 23:30 UTC on the 16th is already 00:30 on the 17th in Vienna.
    expect(localDay(Date.parse('2026-11-16T23:30:00Z'), TZ)).toBe('2026-11-17')
    expect(localMidnight(at('14:20:00'), TZ)).toBe(at('00:00:00'))
    expect(localMidnight(at('00:00:00'), TZ)).toBe(at('00:00:00'))
  })
})

describe('the book', () => {
  it('free time: seconds and XP at valor 0.7', () => {
    const book = run(emptyWorkFile(), 'a', at('09:00:00'), 4)
    expect(book.days['2026-11-16'].freeSeconds).toBe(60)
    expect(dayXp(book.days['2026-11-16'])).toBe(0.7)
  })
  it('mission time: valor 1 and the mission\'s priority; stopping goes back to free time', () => {
    let book = setWorkMission(emptyWorkFile(), { file: 'vow.md', title: 'The vow', priority: 0.5 }, at('09:00:00'))
    book = run(book, 'a', at('09:00:00'), 4)
    expect(book.days['2026-11-16'].missions['vow.md']).toMatchObject({ title: 'The vow', seconds: 60, xp: 1.5 })
    book = setWorkMission(book, null, at('09:01:00'))
    book = applyWorkBeat(book, { tab: 'a', seq: 6, seconds: 15 }, at('09:01:15'), TZ).file
    expect(book.days['2026-11-16'].freeSeconds).toBe(15)
    expect(daySeconds(book.days['2026-11-16'])).toBe(75)
    expect(xpFor(60, 1, 0.5)).toBe(1.5)
  })
  it('a repeated report is not counted twice', () => {
    const book = run(emptyWorkFile(), 'a', at('09:00:00'), 2)
    const again = applyWorkBeat(book, { tab: 'a', seq: 3, seconds: 15 }, at('09:00:31'), TZ)
    expect(again.credited).toBe(0)
    expect(again.file).toBe(book)
  })
  it('never books more seconds than the clock moved', () => {
    const book = run(emptyWorkFile(), 'a', at('09:00:00'), 1)
    const greedy = applyWorkBeat(book, { tab: 'a', seq: 3, seconds: 3600 }, at('09:00:20'), TZ)
    expect(greedy.credited).toBe(5)
    expect(applyWorkBeat(book, { tab: 'a', seq: 3, seconds: -5 }, at('09:00:20'), TZ).credited).toBe(0)
    expect(applyWorkBeat(book, { tab: 'a', seq: 3, seconds: Number.NaN }, at('09:00:20'), TZ).credited).toBe(0)
  })
  it('a second tab is turned away while the first one reports: no double counting', () => {
    let book = run(emptyWorkFile(), 'a', at('09:00:00'), 4)
    const second = applyWorkBeat(book, { tab: 'b', seq: 1, seconds: 15 }, at('09:01:05'), TZ)
    expect(second).toMatchObject({ counting: false, credited: 0 })
    expect(second.file).toBe(book)
    book = applyWorkBeat(book, { tab: 'a', seq: 6, seconds: 15 }, at('09:01:15'), TZ).file
    expect(daySeconds(book.days['2026-11-16'])).toBe(75)
  })
  it('a silent tab loses its place; the new tab starts from zero, and the old one is turned away', () => {
    let book = run(emptyWorkFile(), 'a', at('09:00:00'), 4)
    const takeover = applyWorkBeat(book, { tab: 'b', seq: 1, seconds: 15 }, at('09:01:00') + WORK_HOLDER_STALE_MS, TZ)
    expect(takeover).toMatchObject({ counting: true, credited: 0 })
    book = takeover.file
    expect(applyWorkBeat(book, { tab: 'a', seq: 9, seconds: 15 }, at('09:02:00'), TZ).counting).toBe(false)
    expect(daySeconds(book.days['2026-11-16'])).toBe(60)
  })
  it('a reload: the closing page lets go, the new one counts at once', () => {
    let book = run(emptyWorkFile(), 'a', at('09:00:00'), 2)
    book = releaseWorkHolder(book, 'a')
    expect(releaseWorkHolder(book, 'zzz')).toBe(book)
    const fresh = applyWorkBeat(book, { tab: 'b', seq: 1, seconds: 1 }, at('09:00:32'), TZ)
    expect(fresh.counting).toBe(true)
    book = applyWorkBeat(fresh.file, { tab: 'b', seq: 2, seconds: 15 }, at('09:00:47'), TZ).file
    expect(daySeconds(book.days['2026-11-16'])).toBe(45)
  })
  it('seconds across local midnight are split between the two days', () => {
    let book = applyWorkBeat(emptyWorkFile(), { tab: 'a', seq: 1, seconds: 0 }, at('23:59:50'), TZ).file
    book = applyWorkBeat(book, { tab: 'a', seq: 2, seconds: 15 }, at('00:00:05', '2026-11-17'), TZ).file
    expect(book.days['2026-11-16'].freeSeconds).toBe(10)
    expect(book.days['2026-11-17'].freeSeconds).toBe(5)
  })
  it('a long idle gap books only what the page reports', () => {
    let book = run(emptyWorkFile(), 'a', at('09:00:00'), 1)
    book = applyWorkBeat(book, { tab: 'a', seq: 3, seconds: 15 }, at('11:00:00'), TZ).file
    expect(daySeconds(book.days['2026-11-16'])).toBe(30)
  })
})

describe('the snapshot', () => {
  it('today, and each day of the vow: hit, missed, open, ahead', () => {
    const book = emptyWorkFile()
    book.days['2026-11-16'] = { freeSeconds: 10_800, freeXp: 126, missions: {} }
    book.days['2026-11-17'] = { freeSeconds: 600, freeXp: 7, missions: {} }
    book.days['2026-11-18'] = { freeSeconds: 100, freeXp: 1.17, missions: { 'a.md': { title: 'A', priority: 0.5, seconds: 3000, xp: 75 } } }
    const snap = workSnapshot(book, at('10:00:00', '2026-11-18'), TZ)
    expect(snap.week.map(day => day.status)).toEqual(['hit', 'missed', 'open', 'ahead', 'ahead', 'ahead', 'ahead'])
    expect(snap.today).toMatchObject({ seconds: 3100, freeSeconds: 100, missionSeconds: 3000, xp: 76.2, done: false, remainingSeconds: 7700 })
    expect(snap.today.missions[0]).toMatchObject({ file: 'a.md', seconds: 3000 })
    expect(snap.date).toBe('2026-11-18')
    // Today turns to hit the moment the hours are in.
    book.days['2026-11-18'].freeSeconds = 7800
    expect(workSnapshot(book, at('20:00:00', '2026-11-18'), TZ).week[2].status).toBe('hit')
    expect(workSnapshot(book, at('20:00:00', '2026-11-18'), TZ).today.done).toBe(true)
  })
  it('formats a clock', () => {
    expect(formatClock(0)).toBe('0:00:00')
    expect(formatClock(3 * 3600)).toBe('3:00:00')
    expect(formatClock(5025.9)).toBe('1:23:45')
  })
  it('a damaged file keeps the days that are fine', () => {
    const file = parseWorkFile({ days: { '2026-11-16': { freeSeconds: 50, freeXp: 'x', missions: { 'a.md': { seconds: 5 } } }, nonsense: 4, '2026-11-17': null }, holder: 7, active: { file: 3 } })
    expect(file.days).toEqual({ '2026-11-16': { freeSeconds: 50, freeXp: 0, missions: { 'a.md': { title: 'a.md', priority: 0, seconds: 5, xp: 0 } } } })
    expect(file.holder).toBeNull()
    expect(file.active).toBeNull()
    expect(parseWorkFile(null).vow.dailySeconds).toBe(10_800)
  })
})

describe('the server book (a temp file)', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'work-vow-'))
    process.env.OASIS_WORK_VOW_STATE = path.join(dir, 'book.json')
    process.env.OASIS_MISSIONS_DIR = dir
    writeFileSync(path.join(dir, 'vow.md'), 'state: doing\nwho: owner\ndone when: x\nscore: ease 5 · impact 5 · urgency 5\n\n# The vow\n', 'utf8')
  })
  afterEach(() => {
    delete process.env.OASIS_WORK_VOW_STATE
    delete process.env.OASIS_MISSIONS_DIR
    rmSync(dir, { recursive: true, force: true })
  })
  it('reports, switches mission, survives a reload of the module state, and logs the work in the mission', async () => {
    const server = await import('../work-vow-server')
    const t0 = Date.now()
    expect((await server.reportWorkBeat({ tab: 'a', seq: 1, seconds: 0 }, t0)).counting).toBe(true)
    expect((await server.reportWorkBeat({ tab: 'a', seq: 2, seconds: 15 }, t0 + 15_000)).credited).toBe(15)
    expect((await server.reportWorkBeat({ tab: 'b', seq: 1, seconds: 15 }, t0 + 16_000)).counting).toBe(false)
    const started = await server.switchWorkMission('vow.md', t0 + 16_000)
    expect(started.ok && started.snapshot.active).toMatchObject({ file: 'vow.md', title: 'The vow', priority: 1 })
    for (let i = 3; i <= 7; i += 1) await server.reportWorkBeat({ tab: 'a', seq: i, seconds: 15 }, t0 + i * 15_000 - 15_000)
    const stopped = await server.switchWorkMission(null, t0 + 100_000)
    expect(stopped.ok && stopped.snapshot.active).toBeNull()
    // The book on disk is the truth.
    const disk = parseWorkFile(JSON.parse(readFileSync(process.env.OASIS_WORK_VOW_STATE as string, 'utf8')))
    const days = Object.values(disk.days)
    expect(days.reduce((sum, day) => sum + daySeconds(day), 0)).toBe(90)
    expect(days.reduce((sum, day) => sum + (day.missions['vow.md']?.seconds || 0), 0)).toBe(75)
    expect(readFileSync(path.join(dir, 'vow.md'), 'utf8')).toMatch(/## Log\n- \d{4}-\d\d-\d\d \d\d:\d\d · owner: Worked on this in the Oasis: 0:01:15 so far today, 2\.5 XP\./)
    expect((await server.switchWorkMission('../x.md', t0)).ok).toBe(false)
    expect((await server.switchWorkMission('nope.md', t0)).ok).toBe(false)
    // A closing page lets go: the next tab counts at once.
    await server.reportWorkBeat({ tab: 'a', seq: 8, seconds: 0, release: true }, t0 + 101_000)
    expect((await server.reportWorkBeat({ tab: 'c', seq: 1, seconds: 0 }, t0 + 102_000)).counting).toBe(true)
  })
  it('refuses to overwrite a book it cannot read', async () => {
    const server = await import('../work-vow-server')
    writeFileSync(process.env.OASIS_WORK_VOW_STATE as string, '{ not json', 'utf8')
    await expect(server.reportWorkBeat({ tab: 'a', seq: 1, seconds: 0 })).rejects.toThrow()
    expect(readFileSync(process.env.OASIS_WORK_VOW_STATE as string, 'utf8')).toBe('{ not json')
  })
})

describe('commitments (the first Mindcraft: committed counts double, a miss costs ten times the missing minutes)', () => {
  const book = () => {
    const file = emptyWorkFile()
    file.days['2026-11-16'] = { freeSeconds: 10_800, freeXp: 126, missions: {} }
    file.days['2026-11-17'] = { freeSeconds: 9000, freeXp: 105, missions: {} }
    file.days['2026-11-18'] = { freeSeconds: 3600, freeXp: 42, missions: { 'a.md': { title: 'A', priority: 0.5, seconds: 3600, xp: 90 } } }
    return file
  }
  it('a hit day doubles its XP, a missed day costs 7 XP a missing minute, today shows what is at stake', async () => {
    const { evaluateCommitment, DEFAULT_VOW } = await import('../village/work-vow')
    const view = evaluateCommitment(book(), DEFAULT_VOW, '2026-11-18')
    expect(view).toMatchObject({ multiplier: 2, penaltyFactor: 10, penaltyPerMinute: 7, bonusXp: 126, penaltyXp: 210 })
    expect(view.days.slice(0, 4).map(day => [day.status, day.bonusXp, day.penaltyXp])).toEqual([['hit', 126, 0], ['missed', 0, 210], ['open', 198, 420], ['ahead', 0, 0]])
    // Today: 2 h done at 1.1 XP a minute; the last hour at that pace makes 198, doubled: +198. Stopping: 60 min × 7.
    expect(view.today).toEqual({ remainingSeconds: 3600, bonusIfHit: 198, penaltyIfStopped: 420 })
  })
  it('the snapshot adds it up: XP + bonuses − penalties', () => {
    const snap = workSnapshot(book(), at('12:00:00', '2026-11-18'), TZ)
    expect(snap.totals).toEqual({ xp: 363, bonusXp: 126, penaltyXp: 210, netXp: 279 })
    expect(snap.commitments).toHaveLength(1)
    expect(snap.commitments[0].label).toBe('At least three hours a day in the Oasis')
  })
  it('a commitment to one mission counts only that mission\'s time', async () => {
    const { evaluateCommitment } = await import('../village/work-vow')
    const view = evaluateCommitment(book(), { from: '2026-11-18', to: '2026-11-19', dailySeconds: 3600, mission: 'a.md', multiplier: 3, penaltyFactor: 5 }, '2026-11-19')
    expect(view.days.map(day => [day.seconds, day.status])).toEqual([[3600, 'hit'], [0, 'open']])
    expect(view).toMatchObject({ bonusXp: 180, penaltyXp: 0, penaltyPerMinute: 3.5, mission: 'a.md' })
    expect(view.today).toEqual({ remainingSeconds: 3600, bonusIfHit: 84, penaltyIfStopped: 210 })
  })
  it('reads the stakes from the file, with the old defaults', () => {
    const file = parseWorkFile({ vow: { from: '2026-11-16', to: '2026-11-22', dailySeconds: 7200, multiplier: 1.5 }, commitments: [{ from: 'a', to: 'b', dailySeconds: 60, mission: 'x.md' }, { nope: 1 }] })
    expect(file.vow).toMatchObject({ dailySeconds: 7200, multiplier: 1.5, penaltyFactor: 10 })
    expect(file.commitments).toHaveLength(1)
  })
  it('a late report from a page that let go does not take the place back; coming back from hidden does', () => {
    let file = run(emptyWorkFile(), 'a', at('09:00:00'), 1)
    file = releaseWorkHolder(file, 'a')
    expect(applyWorkBeat(file, { tab: 'a', seq: 9, seconds: 5 }, at('09:00:20'), TZ).counting).toBe(false)
    expect(applyWorkBeat(file, { tab: 'a', seq: 9, seconds: 5, back: true }, at('09:00:20'), TZ).counting).toBe(true)
    expect(applyWorkBeat(file, { tab: 'b', seq: 1, seconds: 0 }, at('09:00:20'), TZ).file.released).toBeUndefined()
  })
})

describe('what the time is counted on', () => {
  const agent = { key: 's-anorak', name: 'Anorak' }
  const card = { file: 'a.md', title: 'A', priority: 0.5 }
  const step = (file: WorkFile, seq: number, focus: Parameters<typeof applyWorkBeat>[1]['focus']) =>
    applyWorkBeat(file, { tab: 'a', seq, seconds: 60, focus }, at('09:00:00') + (seq - 1) * 60_000, TZ).file
  it('an open agent: valor 1, tallied under that agent; a mission card: that mission; neither: free at 0.7', () => {
    let book = applyWorkBeat(emptyWorkFile(), { tab: 'a', seq: 1, seconds: 0 }, at('09:00:00'), TZ).file
    book = step(book, 2, { agent })
    book = step(book, 3, { mission: card })
    book = step(book, 4, {})
    book = step(book, 5, { agent, mission: card })
    const day = book.days['2026-11-16']
    expect(day).toMatchObject({ freeSeconds: 60, freeXp: 0.7, agentSeconds: 60, agentXp: 1 })
    expect(day.missions['a.md']).toMatchObject({ seconds: 120, xp: 3 })
    // With Anorak open for two of the four minutes: one earned as agent time, one as mission time.
    expect(day.agents).toEqual({ 's-anorak': { name: 'Anorak', seconds: 120, xp: 2.5 } })
    expect(daySeconds(day)).toBe(240)
    expect(dayXp(day)).toBe(4.7)
  })
  it('"work on this" wins over the card that is open', () => {
    let book = setWorkMission(emptyWorkFile(), { file: 'vow.md', title: 'Vow', priority: 1 }, at('09:00:00'))
    book = applyWorkBeat(book, { tab: 'a', seq: 1, seconds: 0 }, at('09:00:00'), TZ).file
    book = step(book, 2, { mission: card, agent })
    expect(Object.keys(book.days['2026-11-16'].missions)).toEqual(['vow.md'])
  })
})

describe('agent hours', () => {
  it('an agent\'s own time is its turn minus the waiting on helpers; helpers at once are one wait', async () => {
    const { ownTurnMs } = await import('../village/work-vow')
    expect(ownTurnMs(600_000, 1_000_000, [])).toBe(600_000)
    // Turn 400 s..1000 s. One helper 500..700, one 650..800 (overlap), one still running since 950.
    expect(ownTurnMs(600_000, 1_000_000, [{ start: 500_000, end: 700_000 }, { start: 650_000, end: 800_000 }, { start: 950_000, end: null }])).toBe(250_000)
    // A helper from before the turn counts only for its part inside it; one after it not at all.
    expect(ownTurnMs(100_000, 1_000_000, [{ start: 0, end: 950_000 }, { start: 1_000_000, end: 1_100_000 }])).toBe(50_000)
    expect(ownTurnMs(100_000, 1_000_000, [{ start: 0, end: null }])).toBe(0)
  })
  it('books turns and helpers per agent and day; the same event twice is booked once', async () => {
    const { applyAgentWork, daySummary } = await import('../village/work-vow')
    const ts = at('10:00:00')
    let book = applyAgentWork(emptyWorkFile(), { key: 's1', name: 'Anorak', ts, kind: 'turn', ms: 250_000 }, TZ)
    const again = applyAgentWork(book, { key: 's1', name: 'Anorak', ts, kind: 'turn', ms: 250_000 }, TZ)
    expect(again).toBe(book)
    book = applyAgentWork(book, { key: 's1', name: 'Anorak', ts: ts - 5000, kind: 'helper', ms: 200_000 }, TZ)
    book = applyAgentWork(book, { key: 's1', name: 'Anorak', ts: ts - 4000, kind: 'helper', ms: 150_000 }, TZ)
    book = applyAgentWork(book, { key: 's2', name: 'Morrow', ts: ts + 1000, kind: 'turn', ms: 60_000 }, TZ)
    // An older event replayed after a reload: ignored.
    expect(applyAgentWork(book, { key: 's1', name: 'Anorak', ts: ts - 9000, kind: 'helper', ms: 99_000 }, TZ)).toBe(book)
    // After local midnight: the next day.
    book = applyAgentWork(book, { key: 's2', name: 'Morrow', ts: at('00:10:00', '2026-11-17'), kind: 'turn', ms: 30_000 }, TZ)
    const day = daySummary(book, '2026-11-16', '2026-11-16')
    expect(day.agentHours.totalSeconds).toBe(660)
    expect(day.agentHours.agents).toEqual([
      { key: 's1', name: 'Anorak', ownSeconds: 250, helperSeconds: 350, turns: 1, helpers: 2, totalSeconds: 600 },
      { key: 's2', name: 'Morrow', ownSeconds: 60, helperSeconds: 0, turns: 1, helpers: 0, totalSeconds: 60 },
    ])
    expect(daySummary(book, '2026-11-17', '2026-11-17').agentHours.totalSeconds).toBe(30)
    // Agent hours are not the owner's time: the vow does not move.
    expect(day.seconds).toBe(0)
  })
})

describe('the day summary (the 21:00 message reads this)', () => {
  it('time and XP against the vow, per agent, per mission, top XP, kept or not', async () => {
    const { daySummary } = await import('../village/work-vow')
    const book = emptyWorkFile()
    book.days['2026-11-16'] = {
      freeSeconds: 1800, freeXp: 21, agentSeconds: 3600, agentXp: 60,
      missions: { 'a.md': { title: 'A', priority: 0.5, seconds: 3600, xp: 90 } },
      agents: { s1: { name: 'Anorak', seconds: 4500, xp: 90 }, s2: { name: 'Morrow', seconds: 1500, xp: 30 } },
    }
    const missed = daySummary(book, '2026-11-16', '2026-11-17')
    expect(missed).toMatchObject({ seconds: 9000, targetSeconds: 10_800, remainingSeconds: 1800, xp: 171, kept: false, open: false, bonusXp: 0, penaltyXp: 210, netXp: -39, freeSeconds: 1800, agentSeconds: 3600, missionSeconds: 3600 })
    expect(missed.agents).toEqual([{ key: 's1', name: 'Anorak', seconds: 4500, xp: 90, share: 0.75 }, { key: 's2', name: 'Morrow', seconds: 1500, xp: 30, share: 0.25 }])
    expect(missed.topXp.map(item => [item.label, item.xp, item.kind])).toEqual([['A', 90, 'mission'], ['With agents', 60, 'agents'], ['In the Oasis', 21, 'free']])
    // The same day while it is still running: open, nothing lost yet.
    expect(daySummary(book, '2026-11-16', '2026-11-16')).toMatchObject({ kept: false, open: true, penaltyXp: 0 })
    book.days['2026-11-16'].freeSeconds = 3600
    book.days['2026-11-16'].freeXp = 42
    expect(daySummary(book, '2026-11-16', '2026-11-17')).toMatchObject({ kept: true, open: false, bonusXp: 192, penaltyXp: 0, netXp: 384 })
    expect(workSnapshot(book, at('12:00:00'), TZ).today.topXp[0].label).toBe('A')
    expect(daySummary(book, '2026-12-01', '2026-12-01')).toMatchObject({ seconds: 0, kept: false, bonusXp: 0, penaltyXp: 0 })
  })
})
