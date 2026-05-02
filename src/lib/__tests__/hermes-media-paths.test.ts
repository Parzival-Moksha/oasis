import { describe, expect, it } from 'vitest'

import {
  buildHermesMediaUrl,
  extractHermesMediaReferencesFromText,
  promoteHermesContentMediaReferences,
  shouldProxyHermesMediaPath,
} from '../hermes-media-paths'

describe('hermes media paths', () => {
  it('proxies remote Hermes home media through the local API', () => {
    expect(shouldProxyHermesMediaPath('/home/art3mis/.hermes/audio_cache/tts_20260502_003316.mp3')).toBe(true)
    expect(buildHermesMediaUrl('/home/art3mis/.hermes/audio_cache/tts_20260502_003316.mp3')).toBe(
      '/api/hermes/media?path=%2Fhome%2Fart3mis%2F.hermes%2Faudio_cache%2Ftts_20260502_003316.mp3',
    )
  })

  it('keeps Oasis-generated relative media as app URLs', () => {
    expect(shouldProxyHermesMediaPath('/generated-images/hermes.png')).toBe(false)
    expect(buildHermesMediaUrl('/generated-images/hermes.png')).toBe('/generated-images/hermes.png')
  })

  it('extracts remote markdown image and voice-note paths from assistant prose', () => {
    const refs = extractHermesMediaReferencesFromText(
      'Picture: ![Cyberpunk Art3mis](/home/art3mis/.hermes/images/art3mis.jpeg) Voice note: `/home/art3mis/.hermes/audio_cache/tts_20260502_003316.mp3`',
    )

    expect(refs).toEqual([
      { path: '/home/art3mis/.hermes/images/art3mis.jpeg', mediaType: 'image' },
      { path: '/home/art3mis/.hermes/audio_cache/tts_20260502_003316.mp3', mediaType: 'audio' },
    ])
  })

  it('promotes inline Hermes media references into MEDIA lines without duplicating them', () => {
    const promoted = promoteHermesContentMediaReferences([
      'Picture: ![Cyberpunk Art3mis](/home/art3mis/.hermes/images/art3mis.jpeg)',
      'Voice note: /home/art3mis/.hermes/audio_cache/tts_20260502_003316.mp3',
      'MEDIA:/home/art3mis/.hermes/images/art3mis.jpeg',
    ].join('\n'))

    expect(promoted).toBe([
      'Picture: Cyberpunk Art3mis',
      'MEDIA:/home/art3mis/.hermes/images/art3mis.jpeg',
      'Voice note:',
      'MEDIA:/home/art3mis/.hermes/audio_cache/tts_20260502_003316.mp3',
    ].join('\n'))
  })
})
