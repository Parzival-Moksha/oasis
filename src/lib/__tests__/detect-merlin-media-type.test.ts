// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — detectMerlinMediaType (MerlinPanel.tsx)
// Verifies media type inference including data URIs, local paths,
// extension-based, trusted domains, and ElevenLabs.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi } from 'vitest'

// Mock all heavy dependencies that MerlinPanel imports
vi.mock('@/store/oasisStore', () => ({
  useOasisStore: vi.fn(() => ({})),
}))
vi.mock('@/lib/input-manager', () => ({
  useUILayer: vi.fn(),
}))
vi.mock('@/hooks/useAgentVoiceInput', () => ({
  useAgentVoiceInput: vi.fn(() => ({})),
}))
vi.mock('@/hooks/useAutoresizeTextarea', () => ({
  useAutoresizeTextarea: vi.fn(() => ({})),
}))
vi.mock('@/lib/anorak-renderers', () => ({
  renderMarkdown: vi.fn((s: string) => s),
}))
vi.mock('@/lib/merlin-panel-geometry', () => ({
  clampMerlinGeometry: vi.fn(),
}))
vi.mock('@/lib/player-avatar-runtime', () => ({
  getPlayerAvatarPose: vi.fn(),
}))
vi.mock('@/lib/camera-bridge', () => ({
  getCameraSnapshot: vi.fn(),
}))
vi.mock('../components/forge/MediaBubble', () => ({
  MediaBubble: vi.fn(),
}))
vi.mock('../components/forge/AgentToolCallCard', () => ({
  AgentToolCallCard: vi.fn(),
}))
vi.mock('../components/forge/AgentVoiceInputButton', () => ({
  AgentVoiceInputButton: vi.fn(),
}))
vi.mock('../components/forge/AvatarGallery', () => ({
  AvatarGallery: vi.fn(),
}))
vi.mock('../components/scene-lib', () => ({
  SettingsContext: { Provider: vi.fn() },
}))

import { detectMerlinMediaType, parseMerlinSSE } from '@/components/forge/MerlinPanel'

describe('detectMerlinMediaType', () => {
  // ─── Data URIs ───
  describe('data URIs', () => {
    it('detects data:image/png as image', () => {
      expect(detectMerlinMediaType('data:image/png;base64,iVBORw0KGgo=')).toBe('image')
    })

    it('detects data:image/jpeg as image', () => {
      expect(detectMerlinMediaType('data:image/jpeg;base64,/9j/4AAQ=')).toBe('image')
    })

    it('detects data:audio/mp3 as audio', () => {
      expect(detectMerlinMediaType('data:audio/mp3;base64,SUQz')).toBe('audio')
    })

    it('detects data:video/mp4 as video', () => {
      expect(detectMerlinMediaType('data:video/mp4;base64,AAAAGG=')).toBe('video')
    })
  })

  // ─── Local generated paths ───
  describe('local generated paths', () => {
    it('detects /generated-images/foo.png as image', () => {
      expect(detectMerlinMediaType('/generated-images/foo.png')).toBe('image')
    })

    it('detects /generated-voices/foo.mp3 as audio', () => {
      expect(detectMerlinMediaType('/generated-voices/foo.mp3')).toBe('audio')
    })

    it('detects /generated-videos/foo.mp4 as video', () => {
      expect(detectMerlinMediaType('/generated-videos/foo.mp4')).toBe('video')
    })
  })

  // ─── Extension-based ───
  describe('extension-based', () => {
    it('detects .png URL as image', () => {
      expect(detectMerlinMediaType('https://example.com/img.png')).toBe('image')
    })

    it('detects .jpg URL as image', () => {
      expect(detectMerlinMediaType('https://example.com/photo.jpg')).toBe('image')
    })

    it('detects .gif URL as image', () => {
      expect(detectMerlinMediaType('https://example.com/anim.gif')).toBe('image')
    })

    it('detects .webp URL as image', () => {
      expect(detectMerlinMediaType('https://example.com/modern.webp')).toBe('image')
    })

    it('detects .mp3 URL as audio', () => {
      expect(detectMerlinMediaType('https://example.com/sound.mp3')).toBe('audio')
    })

    it('detects .wav URL as audio', () => {
      expect(detectMerlinMediaType('https://example.com/clip.wav')).toBe('audio')
    })

    it('detects .ogg URL as audio', () => {
      expect(detectMerlinMediaType('https://example.com/clip.ogg')).toBe('audio')
    })

    it('detects .opus URL as audio', () => {
      expect(detectMerlinMediaType('https://example.com/clip.opus')).toBe('audio')
    })

    it('detects .mp4 URL as video', () => {
      expect(detectMerlinMediaType('https://example.com/vid.mp4')).toBe('video')
    })

    it('detects .webm URL as video', () => {
      expect(detectMerlinMediaType('https://example.com/vid.webm')).toBe('video')
    })

    it('detects .m4v URL as video', () => {
      expect(detectMerlinMediaType('https://example.com/vid.m4v')).toBe('video')
    })

    it('handles extension with query string', () => {
      expect(detectMerlinMediaType('https://example.com/img.png?w=200&h=100')).toBe('image')
    })
  })

  // ─── Trusted domains without extension ───
  describe('trusted domains without extension', () => {
    it('fal.media defaults to image', () => {
      expect(detectMerlinMediaType('https://fal.media/files/xxx-yyy-zzz')).toBe('image')
    })

    it('fal.media with video in path returns video', () => {
      expect(detectMerlinMediaType('https://fal.media/files/video/xxx')).toBe('video')
    })

    it('fal-cdn defaults to image', () => {
      expect(detectMerlinMediaType('https://fal-cdn.example.com/files/xxx')).toBe('image')
    })

    it('replicate.delivery defaults to image', () => {
      expect(detectMerlinMediaType('https://replicate.delivery/xxx')).toBe('image')
    })
  })

  // ─── ElevenLabs ───
  describe('ElevenLabs domain', () => {
    it('api.elevenlabs.io returns audio', () => {
      expect(detectMerlinMediaType('https://api.elevenlabs.io/v1/text-to-speech/xxx')).toBe('audio')
    })
  })

  // ─── Non-matching ───
  describe('non-matching', () => {
    it('returns null for plain page URL', () => {
      expect(detectMerlinMediaType('https://example.com/page')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(detectMerlinMediaType('')).toBeNull()
    })

    it('returns null for whitespace-only string', () => {
      expect(detectMerlinMediaType('   ')).toBeNull()
    })
  })

  // ─── Edge cases ───
  describe('edge cases', () => {
    it('trims whitespace before detection', () => {
      expect(detectMerlinMediaType('  /generated-images/foo.png  ')).toBe('image')
    })

    it('is case-insensitive for extensions', () => {
      expect(detectMerlinMediaType('https://example.com/IMG.PNG')).toBe('image')
      expect(detectMerlinMediaType('https://example.com/CLIP.MP3')).toBe('audio')
    })
  })
})

async function collectMerlinEvents(response: Response) {
  const events = []
  for await (const event of parseMerlinSSE(response)) {
    events.push(event)
  }
  return events
}

describe('parseMerlinSSE', () => {
  it('parses standardized usage events', async () => {
    const payload = {
      type: 'usage',
      inputTokens: 700,
      cachedInputTokens: 200,
      outputTokens: 150,
      costUsd: 0.02,
      sessionId: 'merlin-session',
      provider: 'anthropic',
      model: 'opus',
    }

    await expect(
      collectMerlinEvents(new Response(`data: ${JSON.stringify(payload)}\n\n`))
    ).resolves.toEqual([payload])
  })

  it('parses done events carrying token payloads', async () => {
    const payload = {
      type: 'done',
      success: true,
      sessionId: 'merlin-session',
      provider: 'anthropic',
      model: 'opus',
      inputTokens: 700,
      outputTokens: 150,
    }

    await expect(
      collectMerlinEvents(new Response(`data: ${JSON.stringify(payload)}\n\n`))
    ).resolves.toEqual([payload])
  })
})
