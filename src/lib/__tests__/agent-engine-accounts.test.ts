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
  choose: (o?: { pin?: string | null }, now?: number) => { id: string; label: string } | null
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
const { Accounts, parseAccounts, limitFrom, LIMIT_KINDS, UNKNOWN_RESET_MS, CLI } = accountsModule as unknown as {
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
