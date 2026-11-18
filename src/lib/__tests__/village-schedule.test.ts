// How the page words an agent's next wake-up (village-schedule.ts), and the store's side of a scheduled turn.
import { describe, expect, it } from 'vitest'
import { formatWake, scheduleSummary, wakeLine } from '../village/village-schedule'

const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m).getTime()
const NOW = at(2026, 11, 18, 12, 0) // a Wednesday

describe('village schedule wording', () => {
  it('says when it wakes, briefly', () => {
    expect(formatWake(at(2026, 11, 18, 14, 0), NOW)).toBe('14:00')
    expect(formatWake(at(2026, 11, 19, 9, 0), NOW)).toBe('tomorrow 09:00')
    expect(formatWake(at(2026, 11, 21, 9, 30), NOW)).toBe('Sat 09:30')
    expect(formatWake(at(2026, 12, 2, 16, 20), NOW)).toBe('2 Dec 16:20')
    expect(wakeLine({ at: at(2026, 11, 18, 14, 0), label: 'hourly' }, NOW)).toBe('wakes 14:00')
    expect(wakeLine({ at: NOW - 1, label: 'hourly' }, NOW)).toBe('wakes now')
    expect(wakeLine(null, NOW)).toBeNull()
  })

  it('summarises a schedule', () => {
    expect(scheduleSummary(null)).toBe('off')
    expect(scheduleSummary({ every: 'hourly', at: '00:00' })).toBe('every hour')
    expect(scheduleSummary({ every: '3h', at: '01:30' })).toBe('every 3 hours from 01:30')
    expect(scheduleSummary({ every: 'weekly', at: '16:20', day: 3 })).toBe('Wednesdays at 16:20')
  })
})
