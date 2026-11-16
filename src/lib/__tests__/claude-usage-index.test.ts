import { describe, expect, it } from 'vitest'

import { applyLines, hashKey, headlineTokens, localDay, modelFamily, parseUsageLine, summarizeUsage, totalTokens, type FileState, type TokenCounts } from '../claude-usage-index'

function reply(id: string, at: string, usage: Record<string, number>, model = 'claude-fable-5-2', requestId = `req-${id}`) {
  return JSON.stringify({ type: 'assistant', timestamp: at, requestId, message: { id, model, usage } })
}

const U = { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 300 }
const AT = '2026-11-10T09:30:00Z'
const lines = (...l: string[]) => l.join('\n') + '\n'
const fresh = (): FileState => ({ size: 0, offset: 0, keys: [], days: {} as Record<string, TokenCounts>, models: {} as Record<string, TokenCounts> })

describe('parseUsageLine', () => {
  it('reads the four counts, the local day and the reply key (message id + request id)', () => {
    const at = '2026-11-10T09:30:00.000Z'
    const usage = parseUsageLine(reply('m1', at, U))
    expect(usage?.counts).toEqual({ input: 2, cacheWrite: 1000, cacheRead: 5000, output: 300 })
    expect(usage?.day).toBe(localDay(new Date(at)))
    expect(usage?.model).toBe('claude-fable-5-2')
    expect(usage?.key).toBe('m1|req-m1')
  })

  it('skips user lines, broken JSON and all-zero usage', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: { usage: U } }))).toBeNull()
    expect(parseUsageLine('{"type":"assistant","usage": nope')).toBeNull()
    expect(parseUsageLine(reply('m0', '2026-11-10T09:30:00Z', { input_tokens: 0, output_tokens: 0 }))).toBeNull()
  })
})

describe('applyLines', () => {
  it('counts a reply written as several lines once', () => {
    const state = fresh()
    applyLines(state, lines(reply('m1', AT, U), reply('m1', AT, U), reply('m2', AT, U)), new Set())
    expect(state.days[localDay(new Date(AT))]).toEqual({ input: 4, cacheWrite: 2000, cacheRead: 10000, output: 600 })
  })

  it('stops at the last whole line and remembers replies across refreshes', () => {
    const state = fresh()
    const seen = new Set<string>()
    const used = applyLines(state, reply('m1', AT, U) + '\n' + reply('m2', AT, U).slice(0, 20), seen)
    expect(used).toBe(Buffer.byteLength(reply('m1', AT, U) + '\n'))
    applyLines(state, lines(reply('m1', AT, U), reply('m2', AT, U)), seen)
    expect(totalTokens(state.days[localDay(new Date(AT))])).toBe(2 * totalTokens({ input: 2, cacheWrite: 1000, cacheRead: 5000, output: 300 }))
  })

  it('counts a reply copied into another file (a resumed session) once', () => {
    const seen = new Set<string>()
    const original = fresh()
    const resumed = fresh()
    applyLines(original, lines(reply('m1', AT, U), reply('m2', AT, U)), seen)
    applyLines(resumed, lines(reply('m1', AT, U), reply('m2', AT, U), reply('m3', AT, U)), seen)
    const day = localDay(new Date(AT))
    expect(original.days[day].output).toBe(600)
    expect(resumed.days[day].output).toBe(300)
    expect(resumed.keys).toEqual([hashKey('m3|req-m3')])
  })

  it('the same message id from another request is another reply', () => {
    const state = fresh()
    applyLines(state, lines(reply('m1', AT, U, 'claude-opus-5-5', 'r1'), reply('m1', AT, U, 'claude-opus-5-5', 'r2')), new Set())
    expect(state.days[localDay(new Date(AT))].output).toBe(600)
  })
})

describe('the score', () => {
  it('is what the models wrote plus fresh input, never the cache', () => {
    expect(headlineTokens({ input: 2, cacheWrite: 1000, cacheRead: 5_000_000, output: 300 })).toBe(302)
  })

  it('hashes reply keys to 16 hex digits, the same every time', () => {
    expect(hashKey('msg_01abc|req_01xyz')).toMatch(/^[0-9a-f]{16}$/)
    expect(hashKey('msg_01abc|req_01xyz')).toBe(hashKey('msg_01abc|req_01xyz'))
    expect(hashKey('msg_01abc|req_01xyz')).not.toBe(hashKey('msg_01abd|req_01xyz'))
  })
})

describe('summarizeUsage', () => {
  it('today, the last 7 days and all time, deleted transcripts included', () => {
    const now = new Date(2026, 10, 10, 12)
    const c = { input: 1, cacheWrite: 10, cacheRead: 100, output: 1000 }
    const index = {
      version: 3 as const,
      scannedAt: 1,
      files: {
        a: { size: 0, offset: 0, keys: [], days: { '2026-11-10': c, '2026-11-04': c }, models: { 'claude-fable-5-2': c, '<synthetic>': c } },
        b: { size: 0, offset: 0, keys: [], days: { '2026-11-03': c }, models: {}, gone: true },
      },
    }
    const s = summarizeUsage(index, now)
    expect(headlineTokens(s.today)).toBe(1001)
    expect(headlineTokens(s.week)).toBe(2002)
    expect(headlineTokens(s.allTime)).toBe(3003)
    expect(s.allTime.cacheRead).toBe(300)
    expect(s.firstDay).toBe('2026-11-03')
    expect(s.byModel.map(m => m.model)).toEqual(['claude-fable-5-2'])
  })
})

describe('days for the charts', () => {
  it('a day ends at 04:20 local, like the work counter', () => {
    expect(localDay(new Date(2026, 10, 16, 3, 59))).toBe('2026-11-15')
    expect(localDay(new Date(2026, 10, 16, 4, 21))).toBe('2026-11-16')
  })

  it('model families: Opus, Fable (and Mythos), Sonnet, Haiku, other', () => {
    expect(['claude-opus-5-5', 'claude-fable-5-2', 'claude-mythos-5-2', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-5'].map(modelFamily)).toEqual(['opus', 'fable', 'fable', 'sonnet', 'haiku', 'other'])
  })

  it('splits each day by family and fills the last 7 days and every day of the month', () => {
    const state = fresh()
    const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString()
    applyLines(state, lines(
      reply('a', at(16), U, 'claude-opus-5-5'),
      reply('b', at(16), U, 'claude-fable-5-2'),
      reply('c', at(10), U, 'claude-haiku-5-5'),
      reply('d', at(2), U, 'claude-sonnet-5-5'),
    ), new Set())
    const s = summarizeUsage({ version: 3, scannedAt: 1, files: { a: state } }, new Date(2026, 10, 16, 15))
    expect(s.days7.map(d => d.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'])
    expect(s.days7[6].families.opus).toEqual({ output: 300, input: 2 })
    expect(s.days7[6].families.fable).toEqual({ output: 300, input: 2 })
    expect(s.days7[6].total).toBe(604)
    expect(s.days7[0].families.haiku.output).toBe(300)
    expect(s.month.label).toBe('November 2026')
    expect(s.month.days).toHaveLength(30)
    expect(s.month.days[1].families.sonnet.output).toBe(300)
    expect(s.month.days[16].future).toBe(true)
    expect(s.month.days[15].future).toBeUndefined()
  })
})
