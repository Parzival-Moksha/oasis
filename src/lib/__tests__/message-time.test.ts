import { describe, expect, it } from 'vitest'

import { formatMessageTime } from '../village/message-time'

const now = new Date(2026, 10, 10, 17, 40).getTime()

describe('formatMessageTime', () => {
  it('today: just the time', () => {
    expect(formatMessageTime(new Date(2026, 10, 10, 9, 5).getTime(), now)).toBe('09:05')
  })

  it('yesterday', () => {
    expect(formatMessageTime(new Date(2026, 10, 9, 23, 59).getTime(), now)).toBe('yesterday 23:59')
  })

  it('earlier this year, and another year', () => {
    expect(formatMessageTime(new Date(2026, 10, 3, 14, 0).getTime(), now)).toBe('Nov 3, 14:00')
    expect(formatMessageTime(new Date(2025, 0, 2, 8, 30).getTime(), now)).toBe('Jan 2 2025, 08:30')
  })

  it('no time for a missing timestamp', () => {
    expect(formatMessageTime(0, now)).toBe('')
    expect(formatMessageTime(Number.NaN, now)).toBe('')
  })
})
