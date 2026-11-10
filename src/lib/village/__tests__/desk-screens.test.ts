import { describe, expect, it } from 'vitest'

import { DESK_SCREENS_DEFAULT, DESK_SCREEN_LIMIT, DESK_SCREEN_REACH_M, isDeskScreensMode, pickDeskScreens } from '../desk-screens'

const desks = [
  { id: 'far', distance: 40 },
  { id: 'c', distance: 9 },
  { id: 'a', distance: 3 },
  { id: 'b', distance: 6 },
  { id: 'd', distance: 20 },
]
const none = new Set<string>()

describe('desk screens', () => {
  it('off is the default and shows none, however close', () => {
    expect(DESK_SCREENS_DEFAULT).toBe('off')
    expect(pickDeskScreens(desks, DESK_SCREEN_LIMIT.off, none)).toEqual([])
    expect(pickDeskScreens([{ id: 'a', distance: 0.5 }], DESK_SCREEN_LIMIT.off, new Set(['a']))).toEqual([])
  })

  it('nearest shows the closest two within reach', () => {
    expect(pickDeskScreens(desks, DESK_SCREEN_LIMIT.nearest, none)).toEqual(['a', 'b'])
    expect(pickDeskScreens([{ id: 'far', distance: 40 }], DESK_SCREEN_LIMIT.nearest, none)).toEqual([])
  })

  it('all shows every desk within reach, up to its cap, nearest first when over the cap', () => {
    expect(pickDeskScreens(desks, DESK_SCREEN_LIMIT.all, none)).toEqual(['a', 'b', 'c', 'd'])
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, distance: 1 + i }))
    const shown = pickDeskScreens(many, DESK_SCREEN_LIMIT.all, none)
    expect(shown).toHaveLength(DESK_SCREEN_LIMIT.all)
    expect(shown).toEqual(many.slice(0, DESK_SCREEN_LIMIT.all).map(d => d.id))
  })

  it('a screen that already shows stays a little past the reach; a new one does not appear there', () => {
    const edge = [{ id: 'a', distance: DESK_SCREEN_REACH_M + 1 }]
    expect(pickDeskScreens(edge, 2, none)).toEqual([])
    expect(pickDeskScreens(edge, 2, new Set(['a']))).toEqual(['a'])
    expect(pickDeskScreens([{ id: 'a', distance: DESK_SCREEN_REACH_M + 3 }], 2, new Set(['a']))).toEqual([])
  })

  it('knows its three modes and nothing else (a stale saved value falls back)', () => {
    expect(['off', 'nearest', 'all'].every(isDeskScreensMode)).toBe(true)
    expect(isDeskScreensMode('some')).toBe(false)
    expect(isDeskScreensMode(undefined)).toBe(false)
  })
})
