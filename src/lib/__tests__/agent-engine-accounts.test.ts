// Claude accounts (engine accounts.js): the file, choosing, exhaustion until the reset, the CLI login as one quota with
// a token account, and telling a usage refusal from everything else. A fake clock; no process is started.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as accountsModule from '../../../packages/oasis-agent-engine/src/accounts.js'

type View = { villageDefault: string; firstReset: number | null; allExhausted: boolean; accounts: Array<{ id: string; label: string; email: string | null; cli: boolean; sameAs: string | null; exhaustedUntil: number | null; why: string | null; windows: Record<string, { utilization: number | null; resetsAt: number | null }> }> }
interface AccountsLike {
  all: () => Array<{ id: string; token: string | null }>
  choose: (o?: { pin?: string | null; current?: string | null; chrome?: boolean; idleMs?: number; movedAt?: number; loads?: Record<string, number> }, now?: number) => { id: string; label: string; why?: string } | null
  pace: (id: string, now?: number) => { used: number | null; elapsed: number; resetsAt: number; perHour: number | null; dryAt: number | null; dryBeforeReset: boolean; ahead: boolean } | null
  exhaust: (id: string, o?: { resetsAt?: number | null; window?: string | null; kind?: string }, now?: number) => number
  record: (id: string, info: Record<string, unknown>, now?: number) => void
  isExhausted: (id: string, now?: number) => boolean
  allExhausted: (now?: number) => boolean
  firstReset: (now?: number) => number | null
  envFor: (id: string) => Record<string, string | null>
  noteAccount: (id: string, account: { email?: string; subscriptionType?: string }) => void
  aliasOf: (id: string) => string | null
  sameQuota: (id: string) => string[]
  setVillageDefault: (id: string) => string
  view: (now?: number) => View
  reload: () => boolean
  outToCheck: (now?: number) => Array<{ id: string }>
  revive: (id: string, now?: number) => boolean
}
const { Accounts, parseAccounts, limitFrom, LIMIT_KINDS, UNKNOWN_RESET_MS, CLI, CACHE_COLD_MS, MOVE_GAP_MS, paceLine } = accountsModule as unknown as {
  CACHE_COLD_MS: number
  MOVE_GAP_MS: number
  paceLine: (label: string, p: unknown, now?: number) => string
  Accounts: new (o: Record<string, unknown>) => AccountsLike
  parseAccounts: (data: unknown) => Array<{ id: string; label: string; priority: number }>
  limitFrom: (msg: unknown) => { kind: string | null; resetsAt: number | null; window: string | null } | null
  LIMIT_KINDS: Set<string>
  UNKNOWN_RESET_MS: number
  CLI: string
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-accounts-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const NOW = Date.UTC(2026, 10, 19, 12, 0)
function make(accounts: unknown[], extra: Record<string, unknown> = {}) {
  n += 1
  const file = path.join(dir, `accounts-${n}.json`)
  fs.writeFileSync(file, JSON.stringify({ accounts }))
  let t = NOW
  const a = new Accounts({ file, stateFile: path.join(dir, `state-${n}.json`), now: () => t, ...extra })
  return { a, file, set: (ms: number) => { t = ms }, stateFile: path.join(dir, `state-${n}.json`) }
}
const A = { id: 'gmail', label: 'Gmail Ultra', token: 'tok-gmail', priority: 1 }
const B = { id: 'yahoo', label: 'Yahoo Max', token: 'tok-yahoo', priority: 2 }

describe('the accounts file', () => {
  it('keeps only entries with an id and a token, never "cli", no duplicates', () => {
    const list = parseAccounts({ accounts: [A, { id: 'cli', token: 'x' }, { id: 'no-token' }, { ...A, label: 'dup' }, { id: 'Weird Name!', token: 't' }] })
    expect(list.map(x => x.id)).toEqual(['gmail', 'weird-name-'])
    expect(parseAccounts(null)).toEqual([])
  })

  it('the CLI login is always there, last, without a token; the env drops an inherited token for it', () => {
    const { a } = make([A])
    expect(a.all().map(x => [x.id, x.token])).toEqual([['gmail', 'tok-gmail'], [CLI, null]])
    expect(a.envFor('gmail')).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'tok-gmail' })
    expect(a.envFor(CLI)).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: null })
  })

  it('never shows a token in its view', () => {
    const { a } = make([A, B])
    expect(JSON.stringify(a.view())).not.toMatch(/tok-/)
  })

  it('reads the file again when it changed', () => {
    const { a, file } = make([A])
    fs.writeFileSync(file, JSON.stringify({ accounts: [A, B] }))
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(file, later, later)
    expect(a.reload()).toBe(true)
    expect(a.all().map(x => x.id)).toEqual(['gmail', 'yahoo', CLI])
  })
})

describe('choosing an account', () => {
  it('by priority while no reset is known, the CLI login last', () => {
    expect(make([B, A]).a.choose()?.id).toBe('gmail')
    expect(make([]).a.choose()?.id).toBe(CLI)
  })

  it('auto: the account whose week ends first, so its tokens are not lost at the reset', () => {
    const { a } = make([A, B])
    a.record('gmail', { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.5, resetsAt: (NOW + 5 * 86_400_000) / 1000, status: 'allowed' } } })
    a.record('yahoo', { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.1, resetsAt: (NOW + 2 * 86_400_000) / 1000, status: 'allowed' } } })
    expect(a.choose()?.id).toBe('yahoo')
    expect(a.view().accounts.find(x => x.id === 'gmail')?.windows.seven_day).toMatchObject({ utilization: 0.5, resetsAt: NOW + 5 * 86_400_000 })
  })

  it('a pin, then the village default, then auto; never an exhausted one', () => {
    const { a } = make([A, B])
    expect(a.choose({ pin: 'yahoo' })?.id).toBe('yahoo')
    a.setVillageDefault('yahoo')
    expect(a.choose()?.id).toBe('yahoo')
    expect(a.choose({ pin: 'gmail' })?.id).toBe('gmail')
    a.exhaust('yahoo', { resetsAt: NOW + 3_600_000 })
    expect(a.choose()?.id).toBe('gmail') // the default is out: the next one
    expect(a.choose({ pin: 'yahoo' })?.id).toBe('gmail') // a pinned account that is out: the village carries on
    expect(() => a.setVillageDefault('nope')).toThrow(/no account/)
  })
})

describe('running out and coming back', () => {
  it('out until its reset (and a little), then back by itself', () => {
    const { a, set } = make([A, B])
    const until = a.exhaust('gmail', { resetsAt: (NOW + 3 * 3_600_000) / 1000, window: 'five_hour' })
    expect(until).toBe(NOW + 3 * 3_600_000 + 30_000)
    expect(a.isExhausted('gmail')).toBe(true)
    expect(a.choose()?.id).toBe('yahoo')
    expect(a.view().accounts.find(x => x.id === 'gmail')?.why).toBe('five_hour limit')
    set(until + 1)
    expect(a.isExhausted('gmail')).toBe(false)
    expect(a.choose()?.id).toBe('gmail')
  })

  it('a refusal that did not say when: an hour, then it is tried again (a refused try costs nothing)', () => {
    const { a } = make([A])
    expect(a.exhaust('gmail', {})).toBe(NOW + UNKNOWN_RESET_MS + 30_000)
  })

  it('back before its reset when a check turn is taken (the owner upgraded); a model line is not checked', () => {
    const { a } = make([A, B])
    a.exhaust('gmail', { resetsAt: NOW + 3 * 3_600_000, window: 'five_hour' })
    a.exhaust('yahoo', { resetsAt: NOW + 2 * 3_600_000, kind: 'model_requires_usage_credits' })
    a.exhaust(CLI, { resetsAt: NOW + 8 * 3_600_000 })
    expect(a.allExhausted()).toBe(true)
    expect(a.outToCheck().map(x => x.id).sort()).toEqual(['cli', 'gmail'])
    expect(a.revive('gmail')).toBe(true)
    expect(a.isExhausted('gmail')).toBe(false)
    expect(a.allExhausted()).toBe(false)
    expect(a.choose()?.id).toBe('gmail')
    expect(a.view().accounts.find(x => x.id === 'gmail')?.why).toBeNull()
    expect(a.revive('gmail')).toBe(false)
  })

  it('every account out: it says so, and when the first comes back', () => {
    const { a } = make([A, B])
    a.exhaust('gmail', { resetsAt: NOW + 5 * 3_600_000 })
    a.exhaust('yahoo', { resetsAt: NOW + 2 * 3_600_000 })
    expect(a.allExhausted()).toBe(false) // the CLI login is still there
    a.exhaust(CLI, { resetsAt: NOW + 8 * 3_600_000 })
    expect(a.allExhausted()).toBe(true)
    expect(a.choose()).toBeNull()
    expect(a.firstReset()).toBe(NOW + 2 * 3_600_000 + 30_000)
    expect(a.view().allExhausted).toBe(true)
  })

  it('the CLI login and a token account of the same email are one quota', () => {
    const { a } = make([{ ...A, email: 'me@gmail.com' }, B])
    a.noteAccount(CLI, { email: 'me@gmail.com', subscriptionType: 'Claude Ultra' })
    expect(a.aliasOf(CLI)).toBe('gmail')
    expect(a.sameQuota(CLI).sort()).toEqual([CLI, 'gmail'])
    a.exhaust(CLI, { resetsAt: NOW + 3_600_000 })
    expect(a.isExhausted('gmail')).toBe(true)
    a.exhaust('yahoo', { resetsAt: NOW + 3_600_000 })
    expect(a.allExhausted()).toBe(true) // the CLI login is not a third quota
    expect(a.view().accounts.find(x => x.cli)?.sameAs).toBe('gmail')
  })

  it('what it learnt survives a restart (the state file, no tokens in it)', () => {
    const { a, file, stateFile } = make([A, B])
    a.exhaust('gmail', { resetsAt: NOW + 3_600_000 })
    a.setVillageDefault('yahoo')
    const again = new Accounts({ file, stateFile, now: () => NOW })
    expect(again.isExhausted('gmail')).toBe(true)
    expect(again.view().villageDefault).toBe('yahoo')
    expect(fs.readFileSync(stateFile, 'utf8')).not.toMatch(/tok-/)
  })
})

describe('telling a usage refusal from everything else', () => {
  it('only usage_limit_reached and model_requires_usage_credits count', () => {
    expect([...LIMIT_KINDS].sort()).toEqual(['model_requires_usage_credits', 'usage_limit_reached'])
    expect(limitFrom({ type: 'assistant', is_api_error_message: true, api_error_status: 429, api_error: 'usage_limit_reached', error: 'rate_limit' })).toEqual({ kind: 'usage_limit_reached', resetsAt: null, window: null })
    expect(limitFrom({ type: 'result', is_error: true, api_error: 'model_requires_usage_credits' })?.kind).toBe('model_requires_usage_credits')
    expect(limitFrom({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1794226800, rateLimitType: 'five_hour' } })).toEqual({ kind: null, resetsAt: 1794226800000, window: 'five_hour' })
    // Not limits: a 529, the network, a login problem, a warning, an ordinary answer.
    expect(limitFrom({ type: 'assistant', is_api_error_message: true, api_error_status: 529, error: 'server_error' })).toBeNull()
    expect(limitFrom({ type: 'result', is_error: true, api_error: 'connection_failed' })).toBeNull()
    expect(limitFrom({ type: 'result', is_error: true, result: 'Failed to authenticate. API Error: 401' })).toBeNull()
    expect(limitFrom({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.92 } })).toBeNull()
    expect(limitFrom({ type: 'assistant', message: { content: [{ type: 'text', text: "You've hit your limit" }] } })).toBeNull()
  })
})

// 19 Nov: the meter showed Yahoo's 5-hour window at 99% for three hours while claude.ai said 66%. The CLI's event has
// no top-level utilization; every window's figure is in unifiedWindows (seen on the real account: 5h 0.7, week 0.08).
describe('reading usage from the CLI\'s rate_limit_event', () => {
  const REAL = { status: 'allowed', resetsAt: 1795113600, rateLimitType: 'five_hour', overageStatus: 'rejected', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.7, resetsAt: 1795113600, status: 'allowed' }, seven_day: { utilization: 0.08, resetsAt: 1795550400, status: 'allowed' } } }

  it('takes every window from unifiedWindows', () => {
    const { a } = make([B])
    a.record('yahoo', REAL)
    const w = a.view().accounts.find(x => x.id === 'yahoo')!.windows
    expect(w.five_hour).toMatchObject({ utilization: 0.7, resetsAt: 1795113600000, status: 'allowed' })
    expect(w.seven_day).toMatchObject({ utilization: 0.08, resetsAt: 1795550400000 })
  })

  it('never carries an old figure over, and never takes the top-level one for a window\'s', () => {
    const { a, set } = make([B])
    a.record('yahoo', { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.99, resetsAt: 1795113600 })
    expect(a.view().accounts.find(x => x.id === 'yahoo')!.windows.five_hour.utilization).toBeNull()
    a.record('yahoo', REAL)
    set(NOW + 30 * 60_000)
    a.record('yahoo', { status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1795113600 }) // no figure, half an hour later
    expect(a.view().accounts.find(x => x.id === 'yahoo')!.windows.five_hour.utilization).toBeNull()
  })

  it('drops figures saved before the fix: unknown until the next event', () => {
    const file = path.join(dir, 'old-accounts.json')
    const stateFile = path.join(dir, 'old-state.json')
    fs.writeFileSync(file, JSON.stringify({ accounts: [B] }))
    fs.writeFileSync(stateFile, JSON.stringify({ accounts: { yahoo: { windows: { five_hour: { utilization: 0.99, resetsAt: 1, status: 'allowed', at: 1 } } } } }))
    const a = new Accounts({ file, stateFile, now: () => NOW })
    expect(a.view().accounts.find(x => x.id === 'yahoo')!.windows.five_hour.utilization).toBeNull()
  })
})

describe('pace: the week used against the week gone', () => {
  const H = 3_600_000
  const week = (u: number, resetsAt: number) => ({ status: 'allowed', unifiedWindows: { seven_day: { utilization: u, resetsAt: resetsAt / 1000, status: 'allowed' } } })

  it('the dry date at the rate of the last 6 hours, and whether that is before the reset', () => {
    const { a, set } = make([A])
    const reset = NOW + 5 * 86_400_000 // two days of the week gone
    a.record('gmail', week(0.20, reset), NOW)
    set(NOW + 6 * H)
    a.record('gmail', week(0.32, reset), NOW + 6 * H) // 2% an hour: 68% left lasts 34 h, the reset is 114 h away
    const p = a.pace('gmail', NOW + 6 * H)!
    expect(p.used).toBe(0.32)
    expect(p.elapsed).toBeCloseTo((2 * 24 + 6) / (7 * 24), 5)
    expect(p.perHour).toBeCloseTo(0.02, 5)
    expect(p.dryAt).toBe(NOW + 6 * H + 34 * H)
    expect(p.dryBeforeReset).toBe(true)
    expect(p.ahead).toBe(false) // 32% used, 32% of the week gone: on pace, not ahead
    expect(paceLine('Gmail', p, NOW + 6 * H)).toMatch(/^Gmail: week 32% used, 32% of it gone \(behind pace\); at the last 6 h's rate 2\.0% an hour: dry .*, 3 days before its reset/)
  })

  it('unknown stays unknown; a new week starts its samples again', () => {
    const { a, set } = make([A])
    expect(a.pace('gmail')).toBeNull()
    expect(paceLine('Gmail', null)).toBe('Gmail: its week is unknown until it takes a turn')
    const reset = NOW + 86_400_000
    a.record('gmail', week(0.9, reset), NOW)
    set(NOW + 2 * 86_400_000)
    a.record('gmail', week(0.01, reset + 7 * 86_400_000), NOW + 2 * 86_400_000)
    const p = a.pace('gmail', NOW + 2 * 86_400_000)!
    expect(p.used).toBe(0.01)
    expect(p.perHour).toBeNull() // one sample of the new week: no rate yet, not a negative one
  })
})

describe('auto: spreading the village over the accounts', () => {
  const week = (u: number, days: number) => ({ status: 'allowed', unifiedWindows: { seven_day: { utilization: u, resetsAt: (NOW + days * 86_400_000) / 1000, status: 'allowed' } } })

  it('a fresh choice goes where there is most room per active agent', () => {
    const { a } = make([A, B])
    a.record('gmail', week(0.1, 6), NOW)
    a.record('yahoo', week(0.1, 6), NOW)
    expect(a.choose({ loads: { gmail: 0, yahoo: 0, cli: 9 } })?.id).toBe('gmail') // equal: priority
    expect(a.choose({ loads: { gmail: 5, yahoo: 2, cli: 9 } })?.id).toBe('yahoo')
    a.record('yahoo', week(0.8, 6), NOW) // yahoo has a fifth of gmail's room left: it takes fewer agents
    expect(a.choose({ loads: { gmail: 5, yahoo: 0, cli: 9 } })?.id).toBe('yahoo') // 0.2/1 vs 0.9/6
    expect(a.choose({ loads: { gmail: 5, yahoo: 1, cli: 9 } })?.id).toBe('gmail') // 0.2/2 vs 0.9/6
  })

  it('an account near its 5-hour limit counts a quarter', () => {
    const { a } = make([A, B])
    a.record('gmail', { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.1, resetsAt: (NOW + 6 * 86_400_000) / 1000, status: 'allowed' }, five_hour: { utilization: 0.9, resetsAt: (NOW + 3_600_000) / 1000, status: 'allowed' } } }, NOW)
    a.record('yahoo', week(0.4, 6), NOW)
    expect(a.choose({ loads: { cli: 9 } })?.id).toBe('yahoo')
  })

  it('a warm agent keeps its account (its cache); a cold one is free to move', () => {
    const { a } = make([A, B])
    a.record('gmail', week(0.1, 6), NOW)
    a.record('yahoo', week(0.1, 6), NOW)
    const loads = { gmail: 10, yahoo: 0, cli: 9 }
    expect(a.choose({ current: 'gmail', idleMs: 5 * 60_000, loads })?.id).toBe('gmail')
    expect(a.choose({ current: 'gmail', idleMs: CACHE_COLD_MS, loads })?.id).toBe('yahoo')
  })

  it('a warm agent moves when its account runs dry before its reset, at most every few hours', () => {
    const { a, set } = make([A, B])
    const H = 3_600_000
    a.record('gmail', week(0.5, 5), NOW)
    a.record('yahoo', week(0.1, 5), NOW)
    set(NOW + 6 * H)
    a.record('gmail', week(0.8, 5), NOW + 6 * H) // 5% an hour: dry in 4 h, days before its reset
    a.record('yahoo', week(0.1, 5), NOW + 6 * H)
    const t = NOW + 6 * H
    const moved = a.choose({ current: 'gmail', idleMs: 60_000, loads: { gmail: 4, yahoo: 1, cli: 9 } }, t)
    expect(moved?.id).toBe('yahoo')
    expect(moved?.why).toMatch(/runs ahead of its weekly reset/)
    expect(a.choose({ current: 'gmail', idleMs: 60_000, movedAt: t - MOVE_GAP_MS / 2, loads: { gmail: 4, yahoo: 1 } }, t)?.id).toBe('gmail')
  })

  it('Claude in Chrome: the full login (the CLI itself, never a token), while it has usage; a pin still wins', () => {
    const { a } = make([A, B])
    a.noteAccount(CLI, { email: 'me@gmail.com', subscriptionType: 'max' })
    expect(a.choose({ chrome: true })?.id).toBe(CLI)
    expect(a.choose({ chrome: true, pin: 'yahoo' })?.id).toBe('yahoo')
    a.exhaust(CLI, { resetsAt: NOW + 3_600_000 })
    expect(a.choose({ chrome: true })?.id).not.toBe(CLI)
  })
})
