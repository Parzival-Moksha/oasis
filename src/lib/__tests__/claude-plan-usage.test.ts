import { describe, expect, it } from 'vitest'

import { parsePlanUsage, parseResetsText, windowLabel } from '../claude-plan-usage'

const USAGE = `You are currently using your subscription to power your Claude Code usage

Current session: 12% used · resets 3pm (Europe/Budapest)
Current week (all models): 46% used · resets Nov 20, 7:59am (Europe/Budapest)
Current week (Fable): 44% used · resets Nov 20, 8am (Europe/Budapest)

What's contributing to your usage?
Last 24h · 1141 requests · 27 sessions
  89%  Start fresh when you switch tasks · run /clear`

describe("Claude Code's /usage", () => {
  const now = new Date(2026, 10, 16, 14, 30)

  it('reads every window: percent, reset text, time zone, reset time', () => {
    const { windows, subscription } = parsePlanUsage(USAGE, now)
    expect(subscription).toBe(true)
    expect(windows.map(w => [w.label, w.percent, w.resetsText, w.timeZone])).toEqual([
      ['Session (5 h)', 12, '3pm', 'Europe/Budapest'],
      ['Week · all models', 46, 'Nov 20, 7:59am', 'Europe/Budapest'],
      ['Week · Fable', 44, 'Nov 20, 8am', 'Europe/Budapest'],
    ])
    expect(windows[0].resetsAt).toBe(new Date(2026, 10, 16, 15, 0).getTime())
    expect(windows[1].resetsAt).toBe(new Date(2026, 10, 20, 7, 59).getTime())
  })

  it('reads the tips lines as nothing, and survives a mangled middle dot', () => {
    expect(parsePlanUsage('Current week (all models): 46% used Â· resets Nov 20, 7:59am (Europe/Budapest)', now).windows).toHaveLength(1)
    expect(parsePlanUsage('Last 24h · 1141 requests\n  89%  Start fresh', now).windows).toEqual([])
  })

  it('reset times: next year in January, tomorrow for a time already past', () => {
    expect(parseResetsText('Jan 3, 9am', new Date(2026, 11, 30))).toBe(new Date(2027, 0, 3, 9, 0).getTime())
    expect(parseResetsText('1pm', now)).toBe(new Date(2026, 10, 17, 13, 0).getTime())
    expect(parseResetsText('soon', now)).toBeNull()
    expect(windowLabel('week (Opus)')).toBe('Week · Opus')
  })
})
