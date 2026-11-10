import { describe, expect, it } from 'vitest'

import { applyLines, localDay, parseUsageLine, summarizeUsage, totalTokens, type TokenCounts } from '../claude-usage-index'

function reply(id: string, at: string, usage: Record<string, number>, model = 'claude-fable-5-2') {
  return JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model, usage } })
}

const U = { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 300 }

describe('parseUsageLine', () => {
  it('reads the four counts and the local day', () => {
    const at = '2026-11-10T09:30:00.000Z'
    const usage = parseUsageLine(reply('m1', at, U))
    expect(usage?.counts).toEqual({ input: 2, cacheWrite: 1000, cacheRead: 5000, output: 300 })
    expect(usage?.day).toBe(localDay(new Date(at)))
    expect(usage?.model).toBe('claude-fable-5-2')
  })

  it('skips user lines, broken JSON and all-zero usage', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: { usage: U } }))).toBeNull()
    expect(parseUsageLine('{"type":"assistant","usage": nope')).toBeNull()
    expect(parseUsageLine(reply('m0', '2026-11-10T09:30:00Z', { input_tokens: 0, output_tokens: 0 }))).toBeNull()
  })
})

describe('applyLines', () => {
  const fresh = () => ({ size: 0, offset: 0, lastIds: [] as string[], days: {} as Record<string, TokenCounts>, models: {} as Record<string, TokenCounts> })

  it('counts a reply written as several lines once', () => {
    const state = fresh()
    const at = '2026-11-10T09:30:00Z'
    const text = [reply('m1', at, U), reply('m1', at, U), reply('m2', at, U)].join('\n') + '\n'
    applyLines(state, text)
    const day = localDay(new Date(at))
    expect(state.days[day]).toEqual({ input: 4, cacheWrite: 2000, cacheRead: 10000, output: 600 })
  })

  it('stops at the last whole line and remembers ids across refreshes', () => {
    const state = fresh()
    const at = '2026-11-10T09:30:00Z'
    const first = reply('m1', at, U) + '\n' + reply('m2', at, U).slice(0, 20)
    const used = applyLines(state, first)
    expect(used).toBe(Buffer.byteLength(reply('m1', at, U) + '\n'))
    applyLines(state, reply('m1', at, U) + '\n' + reply('m2', at, U) + '\n')
    expect(totalTokens(state.days[localDay(new Date(at))])).toBe(2 * totalTokens({ input: 2, cacheWrite: 1000, cacheRead: 5000, output: 300 }))
  })
})

describe('summarizeUsage', () => {
  it('today, the last 7 days and all time', () => {
    const now = new Date(2026, 10, 10, 12)
    const c = { input: 1, cacheWrite: 10, cacheRead: 100, output: 1000 }
    const index = {
      version: 1 as const,
      scannedAt: 1,
      files: {
        a: { size: 0, offset: 0, lastIds: [], days: { '2026-11-10': c, '2026-11-04': c, '2026-11-03': c }, models: { 'claude-fable-5-2': c, '<synthetic>': c } },
      },
    }
    const s = summarizeUsage(index, now)
    expect(totalTokens(s.today)).toBe(1111)
    expect(totalTokens(s.week)).toBe(2222)
    expect(totalTokens(s.allTime)).toBe(3333)
    expect(s.firstDay).toBe('2026-11-03')
    expect(s.byModel.map(m => m.model)).toEqual(['claude-fable-5-2'])
  })
})
