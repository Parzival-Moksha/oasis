// packages/oasis-agent-engine/src/checkin.js (the 21:00 check-in text and schedule) and its wiring in telegram.js,
// against a fake Bot API and a fake work counter (/api/village/work). The real bot and the Next app are never called.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as checkinModule from '../../../packages/oasis-agent-engine/src/checkin.js'
import * as tgModule from '../../../packages/oasis-agent-engine/src/telegram.js'

type Snap = Record<string, unknown>
const ci = checkinModule as unknown as {
  parseCheckinTime: (s: string) => string | null
  checkinDue: (now: number, c: { on: boolean; time: string; lastSent: string | null }) => string | null
  checkinText: (snap: Snap, now: number) => string
  hm: (s: number) => string
  localDate: (ms: number) => string
}
interface Line {
  start: () => Line
  stop: () => void
  checkinTick: (now?: number) => Promise<boolean>
  command: (a?: Record<string, unknown>) => Record<string, unknown>
  state: { checkin: { on: boolean; time: string; lastSent: string | null } }
  outbox: Promise<unknown>
}
const { TelegramLine } = tgModule as unknown as { TelegramLine: new (o: Record<string, unknown>) => Line }

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime() // local time, Nov 2026
const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']

function snap(worked: number, opts: { date?: string; xp?: number; free?: number; missions?: unknown[]; statuses?: string[]; extra?: Record<string, unknown> } = {}): Snap {
  const date = opts.date || '2026-11-17'
  const statuses = opts.statuses || DATES.map(d => (d < date ? 'hit' : d === date ? (worked >= 10800 ? 'hit' : 'open') : 'ahead'))
  return {
    date,
    targetSeconds: 10800,
    today: { seconds: worked, freeSeconds: opts.free ?? worked, missionSeconds: worked - (opts.free ?? worked), xp: opts.xp ?? 0, done: worked >= 10800, remainingSeconds: Math.max(0, 10800 - worked), missions: opts.missions || [], ...(opts.extra || {}) },
    week: DATES.map((d, i) => ({ date: d, seconds: 0, xp: 0, status: statuses[i] })),
    commitments: [{
      multiplier: 2, penaltyPerMinute: 7,
      days: DATES.map(() => ({ bonusXp: worked >= 10800 ? opts.xp ?? 0 : 0, penaltyXp: 0 })),
      today: worked >= 10800 ? null : { remainingSeconds: 10800 - worked, bonusIfHit: 240, penaltyIfStopped: Math.round(((10800 - worked) / 60) * 7) },
    }],
    totals: { xp: 400, bonusXp: 190, penaltyXp: 0, netXp: 590 },
  }
}

describe('check-in: time and schedule', () => {
  it('reads the times the owner might type', () => {
    expect(ci.parseCheckinTime('21:30')).toBe('21:30')
    expect(ci.parseCheckinTime('21')).toBe('21:00')
    expect(ci.parseCheckinTime('9:05')).toBe('09:05')
    expect(ci.parseCheckinTime('2130')).toBe('21:30')
    expect(ci.parseCheckinTime('9pm')).toBe('21:00')
    expect(ci.parseCheckinTime('9:30 pm')).toBe('21:30')
    expect(ci.parseCheckinTime('12am')).toBe('00:00')
    for (const bad of ['', '25:00', '21:61', 'later', '13pm', '21:3']) expect(ci.parseCheckinTime(bad)).toBeNull()
  })

  it('is due once a day, from its time to midnight', () => {
    const c = { on: true, time: '21:00', lastSent: null as string | null }
    expect(ci.checkinDue(at(17, 20, 59), c)).toBeNull()
    expect(ci.checkinDue(at(17, 21, 0), c)).toBe('2026-11-17')
    expect(ci.checkinDue(at(17, 23, 59), c)).toBe('2026-11-17')
    c.lastSent = '2026-11-17'
    expect(ci.checkinDue(at(17, 22), c)).toBeNull()
    expect(ci.checkinDue(at(18, 8), c)).toBeNull() // yesterday's is never sent the next morning
    expect(ci.checkinDue(at(18, 21), c)).toBe('2026-11-18')
    expect(ci.checkinDue(at(18, 21), { ...c, on: false })).toBeNull()
    expect(ci.checkinDue(at(18, 21, 10), { ...c, time: '21:30' })).toBeNull()
  })
})

describe('check-in: the message', () => {
  const missions = [{ file: 'mission-wall.md', title: 'Missions in the world', seconds: 4200, xp: 105 }, { file: 'fps.md', title: 'Frame rate', seconds: 1800, xp: 30 }]

  it('a kept day: the numbers and a dry well done', () => {
    const text = ci.checkinText(snap(12000, { xp: 190, free: 6000, missions }), at(17, 21))
    expect(text.split('\n')[0]).toBe('🕘 21:00 check-in · Tue 17 Nov · vow day 2/7')
    expect(text).toMatch(/^✅ 3:20 of 3:00\. Vow kept\. Well done\./m)
    expect(text).toContain('XP today: 190, +190 for keeping the vow (x2).')
    expect(text).toContain('Most XP: Missions in the world 1:10 (105), free time in the Oasis 1:40 (55), Frame rate 0:30 (30).')
    expect(text).toContain('Week: ✅✅·····  2/2 kept, 590 XP net.')
    expect(text).not.toMatch(/sucked/)
  })

  it('a short day: says he sucked, by how much, and what is left of the day', () => {
    const text = ci.checkinText(snap(3900, { xp: 60, free: 2100, missions: missions.slice(1) }), at(17, 21))
    expect(text).toMatch(/^❌ 1:05 of 3:00\. You sucked today[:.] 1:55 short/m)
    expect(text).toContain("3:00 till midnight, so it's still a hit if you put in 1:55 now.")
    expect(text).toContain('Stop now: −805 XP. Make it: +240.')
    expect(text).toContain('Week: ✅⏳·····  1/2 kept')
  })

  it('too late to make it: no false hope, the minutes still matter', () => {
    const text = ci.checkinText(snap(3900, { xp: 60 }), at(17, 22, 30))
    expect(text).toContain('1:30 till midnight: too late to close it, but every minute you add still saves 7 XP.')
    expect(text).toContain('Stop now: −805 XP.')
    expect(text).not.toContain('Make it')
  })

  it('a zero day', () => {
    const text = ci.checkinText(snap(0), at(17, 21))
    expect(text).toContain('❌ Zero. Not one minute in the Oasis today, and the vow says 3:00. You sucked today.')
    expect(text).not.toContain('XP today')
    expect(text).not.toContain('Most XP')
  })

  it('uses the counter\'s own summary when it has one: top XP sources and time per agent', () => {
    const text = ci.checkinText(snap(7200, { xp: 120, extra: { topXp: [{ label: 'Academy', seconds: 3600, xp: 80 }, { label: 'free time', seconds: 3600, xp: 40 }], agents: [{ name: 'Tyler', seconds: 2400 }, { name: 'Anorakdev', seconds: 900 }, { name: 'Rick', seconds: 30 }] } }), at(17, 21))
    expect(text).toContain('Most XP: Academy 1:00 (80), free time 1:00 (40).')
    expect(text).toContain('With: Tyler 0:40, Anorakdev 0:15.')
    expect(text).not.toContain('of their own')
    const crew = ci.checkinText({ ...snap(7200, { xp: 120 }), summary: { agentHours: { totalSeconds: 22800 } } }, at(17, 21))
    expect(crew).toContain('The agents put in 6:20 of their own.')
  })

  it('outside the vow: just the day', () => {
    const s = snap(5400, { xp: 63, date: '2026-11-23' })
    const text = ci.checkinText(s, at(23, 21))
    expect(text.split('\n')[0]).toBe('🕘 21:00 check-in · Mon 23 Nov')
    expect(text).toContain('No vow running today. 1:30 in the Oasis, 63 XP.')
    expect(text).not.toContain('Week:')
  })

  it('stays phone-sized', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ file: `m${i}.md`, title: `Mission number ${i}`, seconds: 600, xp: 10 + i }))
    const text = ci.checkinText(snap(7200, { xp: 200, free: 0, missions: many }), at(17, 21))
    expect(text.split('\n').length).toBeLessThanOrEqual(8)
    expect(text.length).toBeLessThan(700)
  })
})

// ------------------------------------------------------------------ scheduled, against fake servers
const TOKEN = '777:checkin-fake-token'
const CHAT = '42'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-checkin-'))
const sent: string[] = []
let updates: Array<Record<string, unknown>> = []
let nextId = 1
let work: Snap | null = snap(3900, { xp: 60 })
let workStatus = 200
let workCalls = 0
const logs: string[] = []
let bot: http.Server
let web: http.Server
let apiBase = ''
let webUrl = ''

function json(res: http.ServerResponse, code: number, obj: unknown) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

beforeAll(async () => {
  bot = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      const m = req.url?.match(/^\/bot([^/]+)\/(\w+)$/)
      if (!m || m[1] !== TOKEN) return json(res, 404, { ok: false, error_code: 404 })
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (m[2] === 'getUpdates') {
        const until = Date.now() + (body.timeout || 0) * 1000
        while (!updates.some(u => (u.update_id as number) >= (body.offset || 0)) && Date.now() < until) await new Promise(r => setTimeout(r, 20))
        updates = updates.filter(u => (u.update_id as number) >= (body.offset || 0))
        return json(res, 200, { ok: true, result: updates })
      }
      if (m[2] === 'sendMessage') sent.push(String(body.text))
      return json(res, 200, { ok: true, result: { message_id: sent.length } })
    })
  })
  web = http.createServer((req, res) => {
    if (req.url !== '/api/village/work') return json(res, 404, { error: 'not found' })
    workCalls++
    if (workStatus !== 200 || !work) return json(res, workStatus, { error: 'boom' })
    return json(res, 200, work)
  })
  await Promise.all([bot, web].map(s => new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()))))
  apiBase = `http://127.0.0.1:${(bot.address() as { port: number }).port}`
  webUrl = `http://127.0.0.1:${(web.address() as { port: number }).port}`
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ enabled: true, botToken: TOKEN, chatId: CHAT, pollingEnabled: false }))
})
afterAll(() => { bot.close(); web.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!pred()) { if (Date.now() > end) throw new Error('timed out'); await sleep(10) }
}

describe('check-in: the schedule in the Telegram line', () => {
  let lines: Line[] = []
  const stateFile = path.join(dir, 'state.json')
  function makeLine(clock: { now: number }) {
    const line = new TelegramLine({
      configFile: path.join(dir, 'config.json'), stateFile, apiBase, webUrl, pollTimeoutS: 1, checkinEveryMs: 0,
      now: () => clock.now, listAgents: () => [], send: async () => ({}), log: (s: string) => logs.push(s),
    }).start()
    lines.push(line)
    return line
  }
  afterEach(async () => {
    for (const l of lines) { await l.outbox; l.stop() }
    lines = []
    sent.length = 0
    updates = []
  })

  it('sends once at its time, remembers the day across a restart, and again the next day', async () => {
    fs.rmSync(stateFile, { force: true })
    work = snap(3900, { xp: 60 })
    const clock = { now: at(17, 20, 59) }
    const line = makeLine(clock)
    expect(await line.checkinTick()).toBe(false)
    clock.now = at(17, 21, 0)
    expect(await line.checkinTick()).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/^🕘 21:00 check-in · Tue 17 Nov/)
    expect(sent[0]).toContain('You sucked today')
    clock.now = at(17, 21, 30)
    expect(await line.checkinTick()).toBe(false)
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).checkin).toEqual({ on: true, time: '21:00', lastSent: '2026-11-17' })
    // An engine restart at 22:00: the same state file, no second message.
    line.stop()
    const again = makeLine(clock)
    clock.now = at(17, 22, 0)
    expect(await again.checkinTick()).toBe(false)
    expect(sent).toHaveLength(1)
    // The next evening.
    work = snap(11000, { xp: 150, date: '2026-11-18' })
    clock.now = at(18, 21, 0)
    expect(await again.checkinTick()).toBe(true)
    expect(sent[1]).toMatch(/Vow kept\. Well done/)
  })

  it('skips quietly while the Next app or the counter is not answering, and sends once it is back', async () => {
    fs.rmSync(stateFile, { force: true })
    work = snap(3900, { xp: 60 })
    workStatus = 500
    const clock = { now: at(17, 21, 0) }
    const line = makeLine(clock)
    expect(await line.checkinTick()).toBe(false)
    clock.now = at(17, 21, 1)
    expect(await line.checkinTick()).toBe(false)
    expect(sent).toEqual([]) // nothing to the owner about it
    expect(logs.filter(l => l.includes('check-in for 2026-11-17 waits'))).toHaveLength(1) // logged once
    workStatus = 200
    clock.now = at(17, 21, 2)
    expect(await line.checkinTick()).toBe(true)
    expect(sent).toHaveLength(1)
    // The page server down altogether: also quiet.
    const deadUrl = 'http://127.0.0.1:9'
    const quiet = new TelegramLine({ configFile: path.join(dir, 'config.json'), stateFile: path.join(dir, 'state-dead.json'), apiBase, webUrl: deadUrl, pollTimeoutS: 1, checkinEveryMs: 0, now: () => at(17, 21), listAgents: () => [], send: async () => ({}), log: (s: string) => logs.push(s) }).start()
    lines.push(quiet)
    expect(await quiet.checkinTick()).toBe(false)
    expect(sent).toHaveLength(1)
    expect(logs.some(l => /check-in for 2026-11-17 waits: the Oasis page server is not reachable/.test(l))).toBe(true)
  })

  it('/checkin off, a new time, now (a preview that does not count as sent), and a bad time', async () => {
    fs.rmSync(stateFile, { force: true })
    workStatus = 200
    work = snap(3900, { xp: 60 })
    const clock = { now: at(17, 20, 0) }
    const line = makeLine(clock)
    const say = async (text: string, n: number) => { updates.push({ update_id: nextId++, message: { chat: { id: Number(CHAT) }, date: Math.floor(Date.now() / 1000), text } }); await until(() => sent.length >= n) }
    await say('/checkin', 1)
    expect(sent[0]).toBe('Check-in is on, every day at 21:00. Next: today at 21:00.')
    await say('/checkin off', 2)
    expect(sent[1]).toMatch(/^Check-in is off/)
    clock.now = at(17, 21, 5)
    expect(await line.checkinTick()).toBe(false)
    await say('/checkin 21:30', 3)
    expect(sent[2]).toBe('Check-in is off. /checkin on brings back the 21:30 sum-up.')
    await say('/checkin on', 4)
    expect(sent[3]).toBe('Check-in is on, every day at 21:30. Next: today at 21:30.')
    expect(await line.checkinTick()).toBe(false) // 21:05 < 21:30
    await say('/checkin now', 5)
    expect(sent[4]).toMatch(/^🕘 21:05 check-in/)
    expect(line.state.checkin.lastSent).toBeNull()
    clock.now = at(17, 21, 31)
    expect(await line.checkinTick()).toBe(true)
    expect(line.state.checkin.lastSent).toBe('2026-11-17')
    await say('/checkin later', 7)
    expect(sent[6]).toMatch(/^A time like 21:30/)
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).checkin).toEqual({ on: true, time: '21:30', lastSent: '2026-11-17' })
  })

  it('the engine command reports and changes it', async () => {
    const line = makeLine({ now: at(17, 12) })
    expect(line.command({ checkinTime: 'soon' })).toMatchObject({ ok: false })
    expect(line.command({ checkin: false, checkinTime: '9pm' }).checkin).toMatchObject({ on: false, time: '21:00' })
    expect(line.command({ checkin: true }).checkin).toMatchObject({ on: true })
    expect(logs.join('\n')).not.toContain(TOKEN)
  })
})
