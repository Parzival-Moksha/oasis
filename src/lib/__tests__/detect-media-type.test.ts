// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — detectMediaType (anorak-renderers.tsx)
// Verifies media type inference from URLs: local paths, extensions,
// trusted domains (fal.media, elevenlabs), data URIs.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import { detectMediaType } from '../anorak-renderers'

describe('detectMediaType (anorak-renderers)', () => {
  // ─── Local generated paths ───
  describe('local generated paths', () => {
    it('detects /generated-images/ as image', () => {
      expect(detectMediaType('/generated-images/foo.png')).toBe('image')
    })

    it('detects generated-images without leading slash', () => {
      expect(detectMediaType('generated-images/bar.jpg')).toBe('image')
    })

    it('detects /generated-voices/ as audio', () => {
      expect(detectMediaType('/generated-voices/foo.mp3')).toBe('audio')
    })

    it('detects generated-voices without leading slash', () => {
      expect(detectMediaType('generated-voices/bar.wav')).toBe('audio')
    })

    it('detects /generated-videos/ as video', () => {
      expect(detectMediaType('/generated-videos/foo.mp4')).toBe('video')
    })

    it('detects generated-videos without leading slash', () => {
      expect(detectMediaType('generated-videos/bar.webm')).toBe('video')
    })
  })

  // ─── Extension-based detection ───
  describe('extension-based detection', () => {
    it('detects .png as image', () => {
      expect(detectMediaType('https://example.com/img.png')).toBe('image')
    })

    it('detects .jpg as image', () => {
      expect(detectMediaType('https://example.com/photo.jpg')).toBe('image')
    })

    it('detects .jpeg as image', () => {
      expect(detectMediaType('https://example.com/photo.jpeg')).toBe('image')
    })

    it('detects .gif as image', () => {
      expect(detectMediaType('https://example.com/anim.gif')).toBe('image')
    })

    it('detects .webp as image', () => {
      expect(detectMediaType('https://example.com/modern.webp')).toBe('image')
    })

    it('detects .mp3 as audio', () => {
      expect(detectMediaType('https://example.com/song.mp3')).toBe('audio')
    })

    it('detects .wav as audio', () => {
      expect(detectMediaType('https://example.com/clip.wav')).toBe('audio')
    })

    it('detects .ogg as audio', () => {
      expect(detectMediaType('https://example.com/clip.ogg')).toBe('audio')
    })

    it('detects .mp4 as video', () => {
      expect(detectMediaType('https://example.com/vid.mp4')).toBe('video')
    })

    it('detects .webm as video', () => {
      expect(detectMediaType('https://example.com/vid.webm')).toBe('video')
    })

    it('handles extension with query params', () => {
      expect(detectMediaType('https://example.com/img.png?w=200')).toBe('image')
    })
  })

  // ─── Trusted domains without extension ───
  describe('trusted domains without extension', () => {
    it('fal.media defaults to image', () => {
      expect(detectMediaType('https://fal.media/files/xxx-yyy-zzz')).toBe('image')
    })

    it('fal.media with video in path returns video', () => {
      expect(detectMediaType('https://fal.media/files/video/xxx')).toBe('video')
    })

    it('fal-cdn defaults to image', () => {
      expect(detectMediaType('https://fal-cdn.example.com/files/xxx')).toBe('image')
    })

    it('replicate.delivery defaults to image', () => {
      expect(detectMediaType('https://replicate.delivery/xxx')).toBe('image')
    })

    it('oaidalleapiprodscus defaults to image', () => {
      expect(detectMediaType('https://oaidalleapiprodscus.blob.core.windows.net/xxx')).toBe('image')
    })
  })

  // ─── ElevenLabs ───
  describe('ElevenLabs domain', () => {
    it('api.elevenlabs.io returns audio', () => {
      expect(detectMediaType('https://api.elevenlabs.io/v1/text-to-speech/xxx')).toBe('audio')
    })

    it('elevenlabs.io/ returns audio', () => {
      expect(detectMediaType('https://elevenlabs.io/some-path')).toBe('audio')
    })
  })

  // ─── Non-matching ───
  describe('non-matching URLs', () => {
    it('returns null for plain page URL', () => {
      expect(detectMediaType('https://example.com/page')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(detectMediaType('')).toBeNull()
    })

    it('returns null for URL without known extension or domain', () => {
      expect(detectMediaType('https://random-site.com/data')).toBeNull()
    })
  })
})
