import { describe, expect, it } from 'vitest'

import { isLocalGeneratedMediaPath } from '@/components/forge/MediaBubble'

describe('MediaBubble helpers', () => {
  it('recognizes generated media paths even under a base path', () => {
    expect(isLocalGeneratedMediaPath('/generated-voices/voice-1.mp3')).toBe(true)
    expect(isLocalGeneratedMediaPath('/oasis/generated-voices/voice-1.mp3')).toBe(true)
    expect(isLocalGeneratedMediaPath('/merlin/screenshots/shot-1.jpg')).toBe(true)
    expect(isLocalGeneratedMediaPath('/api/not-media')).toBe(false)
  })
})
