import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../byte-range'

describe('parseByteRange', () => {
  it('reads the forms browsers send', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
  })
  it('answers in full without a usable range, and refuses one past the end', () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange('bytes=0-1,5-9', 100)).toBeNull()
    expect(parseByteRange('bytes=-', 100)).toBeNull()
    expect(parseByteRange('bytes=100-', 100)).toBe('invalid')
    expect(parseByteRange('bytes=20-10', 100)).toBe('invalid')
    expect(parseByteRange('bytes=-0', 100)).toBe('invalid')
  })
})
