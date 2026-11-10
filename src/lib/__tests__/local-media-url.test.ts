import { describe, expect, it } from 'vitest'

import { isCrossOrigin, resolveLocalMediaUrl } from '../local-media-url'

const PAGE = 'http://localhost:4516'

describe('resolveLocalMediaUrl', () => {
  it('an agent wrote 127.0.0.1, the owner opened localhost: same file, same origin', () => {
    expect(resolveLocalMediaUrl('http://127.0.0.1:4516/generated-videos/claude_test_borg_short.mp4', PAGE))
      .toBe('http://localhost:4516/generated-videos/claude_test_borg_short.mp4')
  })

  it('and the other way round, keeping query and hash', () => {
    expect(resolveLocalMediaUrl('http://localhost:4516/generated-images/a.png?v=2#x', 'http://127.0.0.1:4516'))
      .toBe('http://127.0.0.1:4516/generated-images/a.png?v=2#x')
  })

  it('Oasis media folders are rewritten even when the agent named another port', () => {
    expect(resolveLocalMediaUrl('http://127.0.0.1:3000/generated-music/song.mp3', PAGE)).toBe('http://localhost:4516/generated-music/song.mp3')
  })

  it('leaves other local services alone (the agent engine serves files on 4530)', () => {
    expect(resolveLocalMediaUrl('http://127.0.0.1:4530/file/abc', PAGE)).toBe('http://127.0.0.1:4530/file/abc')
  })

  it('leaves the internet, relative paths and data URLs alone', () => {
    expect(resolveLocalMediaUrl('https://cdn.example.com/v.mp4', PAGE)).toBe('https://cdn.example.com/v.mp4')
    expect(resolveLocalMediaUrl('/generated-videos/v.mp4', PAGE)).toBe('/generated-videos/v.mp4')
    expect(resolveLocalMediaUrl('data:image/png;base64,AAAA', PAGE)).toBe('data:image/png;base64,AAAA')
  })

  it('a hosted page never rewrites to itself from loopback URLs', () => {
    expect(resolveLocalMediaUrl('http://127.0.0.1:4516/generated-videos/v.mp4', 'https://04515.xyz')).toBe('http://127.0.0.1:4516/generated-videos/v.mp4')
  })
})

describe('isCrossOrigin', () => {
  it('compares origins', () => {
    expect(isCrossOrigin('http://127.0.0.1:4516/x.mp4', PAGE)).toBe(true)
    expect(isCrossOrigin('http://localhost:4516/x.mp4', PAGE)).toBe(false)
    expect(isCrossOrigin('/x.mp4', PAGE)).toBe(false)
  })
})
