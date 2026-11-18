import { describe, expect, it } from 'vitest'

import { SCROLL_QUIET_MS, holdForScrollMs, noteThreadScroll } from '../../../components/village/village-history'

describe('older history waits for the wheel to be still', () => {
  it('lands at once when the thread was not scrolled', () => {
    expect(holdForScrollMs('quiet-agent', 1_000)).toBe(0)
  })

  it('waits until the last scroll is SCROLL_QUIET_MS old', () => {
    noteThreadScroll('busy', 10_000)
    expect(holdForScrollMs('busy', 10_050)).toBe(SCROLL_QUIET_MS - 50)
    expect(holdForScrollMs('busy', 10_000 + SCROLL_QUIET_MS)).toBe(0)
  })

  it('never holds a piece forever, even while the owner keeps scrolling', () => {
    noteThreadScroll('forever', 40_000)
    expect(holdForScrollMs('forever', 40_010, 25_000)).toBe(0)
  })
})
