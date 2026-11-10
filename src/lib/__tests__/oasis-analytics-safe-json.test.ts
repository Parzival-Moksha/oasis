import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/token-burn', () => ({ readTokenBurnSummary: async () => null }))

import { FEEDBACK_METADATA_MAX, safeJson } from '../oasis-analytics'

describe('safeJson', () => {
  it('keeps a long dictated feedback message whole', () => {
    const text = 'word '.repeat(9000) // 45,000 characters
    const stored = safeJson({ text, path: '/' }, FEEDBACK_METADATA_MAX)
    expect(JSON.parse(stored as string).text).toBe(text)
  })

  it('never cuts the JSON itself: an oversized value becomes a valid, marked preview', () => {
    const stored = safeJson({ text: 'x'.repeat(20000) })
    const parsed = JSON.parse(stored as string)
    expect(parsed.truncated).toBe(true)
    expect(parsed.length).toBeGreaterThan(20000)
    expect((stored as string).length).toBeLessThanOrEqual(8000)
  })

  it('small values pass through', () => {
    expect(safeJson({ a: 1 })).toBe('{"a":1}')
    expect(safeJson(null)).toBeUndefined()
  })
})
