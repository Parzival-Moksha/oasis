import { describe, expect, it } from 'vitest'
import { sessionToShow, withoutSession } from '../village/village-show'

describe('village show: the session a page was opened for', () => {
  it('reads a session uuid from the query string', () => {
    expect(sessionToShow('?profile=village&session=7D97FABF-a39a-46be-83c5-f3def276478f')).toBe('7d97fabf-a39a-46be-83c5-f3def276478f')
  })

  it('ignores a missing or malformed session', () => {
    expect(sessionToShow('?profile=village')).toBeNull()
    expect(sessionToShow('?session=../../etc')).toBeNull()
    expect(sessionToShow('?session=7d97fabf')).toBeNull()
  })

  it('drops only the session from the query string', () => {
    expect(withoutSession('?profile=village&session=7d97fabf-a39a-46be-83c5-f3def276478f')).toBe('?profile=village')
    expect(withoutSession('?session=7d97fabf-a39a-46be-83c5-f3def276478f')).toBe('')
  })
})
