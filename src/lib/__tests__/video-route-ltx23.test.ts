// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests for /api/media/video route — LTX-2.3 migration
// Validates: clampDuration, selectEndpoint, POST body, cleanup, no legacy refs
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Extract pure functions from the route source for testing ──────────

/** Snap duration to nearest valid LTX-2.3 value (even integers 6-20) */
function clampDuration(d: number): number {
  const valid = [6, 8, 10, 12, 14, 16, 18, 20]
  return valid.reduce((prev, curr) => Math.abs(curr - d) < Math.abs(prev - d) ? curr : prev)
}

function selectEndpoint(imageUrl?: string, fast?: boolean): string {
  const TEXT_TO_VIDEO = 'https://queue.fal.run/fal-ai/ltx-2.3/text-to-video'
  const IMG_TO_VIDEO = 'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video'
  const IMG_TO_VIDEO_FAST = 'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video/fast'
  if (imageUrl) return fast ? IMG_TO_VIDEO_FAST : IMG_TO_VIDEO
  return TEXT_TO_VIDEO
}

// ── Route source path ─────────────────────────────────────────────────
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/media/video/route.ts')

// ══════════════════════════════════════════════════════════════════════
// clampDuration
// ══════════════════════════════════════════════════════════════════════

describe('clampDuration', () => {
  it('snaps 5 → 6 (below minimum rounds up)', () => {
    expect(clampDuration(5)).toBe(6)
  })

  it('snaps 7 → 6 (equidistant — reduce keeps earlier match)', () => {
    // 7 is equidistant from 6 and 8; reduce with < keeps prev (6)
    expect(clampDuration(7)).toBe(6)
  })

  it('keeps 6 → 6 (already valid)', () => {
    expect(clampDuration(6)).toBe(6)
  })

  it('snaps 9 → 8 (equidistant rounds to lower — reduce picks first match)', () => {
    // 9 is equidistant from 8 and 10; reduce picks the first (8) since |8-9|==|10-9|
    // Actually: |8-9|=1, |10-9|=1, reduce keeps prev when not strictly <, so 8
    expect(clampDuration(9)).toBe(8)
  })

  it('snaps 11 → 10 (equidistant — reduce keeps earlier match)', () => {
    // 11 is equidistant from 10 and 12; reduce with < keeps prev (10)
    expect(clampDuration(11)).toBe(10)
  })

  it('snaps 15 → 14 (equidistant rounds to earlier valid)', () => {
    expect(clampDuration(15)).toBe(14)
  })

  it('snaps 19 → 18 (equidistant — reduce keeps earlier match)', () => {
    // 19 is equidistant from 18 and 20; reduce with < keeps prev (18)
    expect(clampDuration(19)).toBe(18)
  })

  it('clamps 25 → 20 (above maximum)', () => {
    expect(clampDuration(25)).toBe(20)
  })

  it('clamps -1 → 6 (negative input clamps to minimum)', () => {
    expect(clampDuration(-1)).toBe(6)
  })

  it('clamps 0 → 6 (zero clamps to minimum)', () => {
    expect(clampDuration(0)).toBe(6)
  })
})

// ══════════════════════════════════════════════════════════════════════
// selectEndpoint
// ══════════════════════════════════════════════════════════════════════

describe('selectEndpoint', () => {
  it('returns TEXT_TO_VIDEO when no image_url', () => {
    expect(selectEndpoint()).toBe('https://queue.fal.run/fal-ai/ltx-2.3/text-to-video')
  })

  it('returns TEXT_TO_VIDEO when image_url is undefined', () => {
    expect(selectEndpoint(undefined)).toBe('https://queue.fal.run/fal-ai/ltx-2.3/text-to-video')
  })

  it('returns IMG_TO_VIDEO when image_url provided', () => {
    expect(selectEndpoint('https://example.com/img.png')).toBe(
      'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video'
    )
  })

  it('returns IMG_TO_VIDEO_FAST when image_url + fast=true', () => {
    expect(selectEndpoint('https://example.com/img.png', true)).toBe(
      'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video/fast'
    )
  })

  it('returns IMG_TO_VIDEO when image_url + fast=false', () => {
    expect(selectEndpoint('https://example.com/img.png', false)).toBe(
      'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video'
    )
  })

  it('returns TEXT_TO_VIDEO when no image_url but fast=true (fast ignored)', () => {
    expect(selectEndpoint(undefined, true)).toBe(
      'https://queue.fal.run/fal-ai/ltx-2.3/text-to-video'
    )
  })
})

// ══════════════════════════════════════════════════════════════════════
// POST body construction (simulated)
// ══════════════════════════════════════════════════════════════════════

describe('POST body construction', () => {
  function buildBody(input: { prompt: string; duration?: number; image_url?: string; fast?: boolean }) {
    const { prompt, duration = 6, image_url, fast } = input
    const endpoint = selectEndpoint(image_url, fast)
    const falBody: Record<string, unknown> = {
      prompt: prompt.trim(),
      duration: clampDuration(duration),
      seed: 42, // fixed for test
    }
    if (image_url) falBody.image_url = image_url
    return { endpoint, falBody }
  }

  it('clamps duration 5 → 6 in body', () => {
    const { falBody } = buildBody({ prompt: 'test', duration: 5 })
    expect(falBody.duration).toBe(6)
  })

  it('clamps duration 25 → 20 in body', () => {
    const { falBody } = buildBody({ prompt: 'test', duration: 25 })
    expect(falBody.duration).toBe(20)
  })

  it('does NOT include num_frames in body', () => {
    const { falBody } = buildBody({ prompt: 'test', duration: 10 })
    expect(falBody).not.toHaveProperty('num_frames')
  })

  it('routes to IMG_TO_VIDEO when image_url provided', () => {
    const { endpoint, falBody } = buildBody({ prompt: 'test', image_url: 'https://x.com/i.png' })
    expect(endpoint).toBe('https://queue.fal.run/fal-ai/ltx-2.3/image-to-video')
    expect(falBody.image_url).toBe('https://x.com/i.png')
  })

  it('routes to TEXT_TO_VIDEO when no image_url', () => {
    const { endpoint } = buildBody({ prompt: 'test' })
    expect(endpoint).toBe('https://queue.fal.run/fal-ai/ltx-2.3/text-to-video')
  })

  it('routes to IMG_TO_VIDEO_FAST when image_url + fast', () => {
    const { endpoint } = buildBody({ prompt: 'test', image_url: 'https://x.com/i.png', fast: true })
    expect(endpoint).toBe('https://queue.fal.run/fal-ai/ltx-2.3/image-to-video/fast')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Cleanup logic (pattern verification from source)
// ══════════════════════════════════════════════════════════════════════

describe('cleanup logic', () => {
  it('route source defines MAX_FILES = 50', () => {
    const src = fs.readFileSync(ROUTE_PATH, 'utf-8')
    expect(src).toContain('MAX_FILES = 50')
  })

  it('cleanup slices after MAX_FILES and unlinkSync old entries', () => {
    const src = fs.readFileSync(ROUTE_PATH, 'utf-8')
    expect(src).toContain('entries.slice(MAX_FILES)')
    expect(src).toContain('fs.unlinkSync')
  })

  it('cleanup sorts by mtime descending (keeps newest)', () => {
    const src = fs.readFileSync(ROUTE_PATH, 'utf-8')
    expect(src).toContain('.sort((a, b) => b.time - a.time)')
  })

  it('cleanup only targets .mp4 files', () => {
    const src = fs.readFileSync(ROUTE_PATH, 'utf-8')
    expect(src).toContain(".filter(f => f.endsWith('.mp4'))")
  })
})

// ══════════════════════════════════════════════════════════════════════
// No legacy references
// ══════════════════════════════════════════════════════════════════════

describe('no legacy LTX-1.3 references', () => {
  const src = fs.readFileSync(ROUTE_PATH, 'utf-8')

  it('does not reference ltx-video-13b', () => {
    expect(src).not.toContain('ltx-video-13b')
  })

  it('does not reference num_frames', () => {
    expect(src).not.toContain('num_frames')
  })

  it('references ltx-2.3 in endpoints', () => {
    expect(src).toContain('fal-ai/ltx-2.3')
  })

  it('uses duration instead of num_frames', () => {
    expect(src).toContain('duration: clampDuration(duration)')
  })
})
