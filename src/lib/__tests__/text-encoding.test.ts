import { describe, expect, it } from 'vitest'

import { cleanWorldIcon, looksLikeLostEmoji } from '../text-encoding'

describe('lost emoji', () => {
  it('spots an emoji that became question marks or replacement characters', () => {
    expect(looksLikeLostEmoji('??')).toBe(true)
    expect(looksLikeLostEmoji('?')).toBe(true)
    expect(looksLikeLostEmoji('��')).toBe(true)
    expect(looksLikeLostEmoji('🔥')).toBe(false)
    expect(looksLikeLostEmoji('')).toBe(false)
  })

  it('keeps a real icon and replaces a lost one', () => {
    expect(cleanWorldIcon('🔥')).toBe('🔥')
    expect(cleanWorldIcon('??')).toBe('🌍')
    expect(cleanWorldIcon(undefined, '📦')).toBe('📦')
  })
})
