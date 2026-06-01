import { describe, expect, it } from 'vitest'
import { isRealtimeUnsafeMediaUrl, resolvePlacementVfxType } from '../slices/placementSlice'

describe('placement slice helpers', () => {
  it('keeps realtime object broadcasts away from local-only media payloads', () => {
    expect(isRealtimeUnsafeMediaUrl('blob:http://localhost/video')).toBe(true)
    expect(isRealtimeUnsafeMediaUrl(`data:video/mp4;base64,${'a'.repeat(17 * 1024)}`)).toBe(true)
    expect(isRealtimeUnsafeMediaUrl('/uploads/video.mp4')).toBe(false)
  })

  it('resolves random placement VFX deterministically when a random source is injected', () => {
    expect(resolvePlacementVfxType('random', 'runeflash', () => 0)).toBe('runeflash')
    expect(resolvePlacementVfxType('random', 'runeflash', () => 0.999)).toBe('stellarforge')
    expect(resolvePlacementVfxType(undefined, 'sparkburst', () => 0)).toBe('sparkburst')
  })
})
