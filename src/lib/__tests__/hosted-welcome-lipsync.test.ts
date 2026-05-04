import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  createHostedWelcomeTimedController,
  loadHostedWelcomeTiming,
  resetHostedWelcomeTimingCacheForTest,
} from '../hosted-welcome-lipsync'
import type { ElevenLabsAlignment } from '../lip-sync-lab'

function alignmentFor(text: string): ElevenLabsAlignment {
  return {
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => index * 0.1),
    character_end_times_seconds: [...text].map((_, index) => index * 0.1 + 0.1),
  }
}

describe('hosted welcome lip sync', () => {
  beforeEach(() => {
    resetHostedWelcomeTimingCacheForTest()
  })

  it('loads normalized ElevenLabs timing when available', async () => {
    const normalizedAlignment = alignmentFor('Welcome')
    const rawAlignment = alignmentFor('raw')
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        alignment: rawAlignment,
        normalizedAlignment,
      }),
    })

    await expect(loadHostedWelcomeTiming(fetcher as unknown as typeof fetch)).resolves.toBe(normalizedAlignment)
    await loadHostedWelcomeTiming(fetcher as unknown as typeof fetch)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('drives mouth weights from the audio currentTime without WebAudio', () => {
    const controller = createHostedWelcomeTimedController(alignmentFor('aa'))
    expect(controller).not.toBeNull()

    const audio = {
      paused: false,
      ended: false,
      currentTime: 0.05,
    } as HTMLMediaElement

    controller!.attachAudio(audio)
    expect(controller!.isActive).toBe(true)
    expect(controller!.update().ee).toBeGreaterThan(0)

    ;(audio as unknown as { paused: boolean }).paused = true
    expect(controller!.update()).toEqual({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  })
})
