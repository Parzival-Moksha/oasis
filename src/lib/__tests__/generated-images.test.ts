import { describe, expect, it } from 'vitest'

import { findMissingLocalGeneratedImageIds, isLocalGeneratedImageUrl } from '../generated-images'
import type { GeneratedImage } from '../conjure/types'

function image(id: string, url: string): GeneratedImage {
  return {
    id,
    prompt: id,
    url,
    tileUrl: url,
    createdAt: '2026-04-25T00:00:00.000Z',
  }
}

describe('generated image cleanup', () => {
  it('recognizes only same-origin generated image files as local gallery refs', () => {
    expect(isLocalGeneratedImageUrl('/generated-images/example.png')).toBe(true)
    expect(isLocalGeneratedImageUrl('/images/example.png')).toBe(false)
    expect(isLocalGeneratedImageUrl('https://example.com/image.png')).toBe(false)
    expect(isLocalGeneratedImageUrl('/generated-images/../secret.png')).toBe(false)
  })

  it('finds missing local generated image refs without touching remote refs', async () => {
    const missing = await findMissingLocalGeneratedImageIds(
      [
        image('kept', '/generated-images/kept.png'),
        image('missing', '/generated-images/missing.png'),
        image('remote', 'https://example.com/missing.png'),
      ],
      async url => !url.includes('missing.png'),
    )

    expect(missing).toEqual(['missing'])
  })
})
