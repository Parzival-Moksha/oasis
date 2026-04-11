import { describe, it, expect } from 'vitest'
import {
  CRAFT_TEXTURE_PRESETS,
  CRAFT_TEXTURE_MAP,
  getCraftTexturePreset,
  canHaveTexture,
  computeAutoTiling,
} from '../forge/craft-textures'

describe('craft-textures preset library', () => {
  it('has 24 texture presets (12 hires + 12 lowpoly)', () => {
    expect(CRAFT_TEXTURE_PRESETS).toHaveLength(24)
  })

  it('all presets have required fields', () => {
    for (const p of CRAFT_TEXTURE_PRESETS) {
      expect(p.id, `${p.id} missing id`).toBeTruthy()
      expect(p.name, `${p.id} missing name`).toBeTruthy()
      expect(p.texturePath, `${p.id} missing texturePath`).toBeTruthy()
      expect(p.fallbackColor, `${p.id} missing fallbackColor`).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(p.naturalSizeMeters, `${p.id} naturalSizeMeters`).toBeGreaterThan(0)
      expect(['stone', 'wood', 'metal', 'nature', 'urban', 'snow', 'lowpoly']).toContain(p.category)
      expect(['1k', '64']).toContain(p.resolution)
    }
  })

  it('all preset IDs are unique', () => {
    const ids = CRAFT_TEXTURE_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('CRAFT_TEXTURE_MAP has same count as array', () => {
    expect(CRAFT_TEXTURE_MAP.size).toBe(CRAFT_TEXTURE_PRESETS.length)
  })

  it('getCraftTexturePreset returns preset for valid ID', () => {
    const stone = getCraftTexturePreset('stone')
    expect(stone).toBeDefined()
    expect(stone!.name).toBe('Mossy Stone')
    expect(stone!.texturePath).toContain('/ground/')
  })

  it('getCraftTexturePreset returns undefined for invalid ID', () => {
    expect(getCraftTexturePreset('nonexistent')).toBeUndefined()
    expect(getCraftTexturePreset('')).toBeUndefined()
  })

  it('hires presets point to /ground/ textures', () => {
    const hires = CRAFT_TEXTURE_PRESETS.filter(p => p.resolution === '1k')
    expect(hires.length).toBe(12)
    for (const p of hires) {
      expect(p.texturePath, p.id).toContain('/ground/')
    }
  })

  it('lowpoly presets point to /models/kenney- textures', () => {
    const lowpoly = CRAFT_TEXTURE_PRESETS.filter(p => p.resolution === '64')
    expect(lowpoly.length).toBe(12)
    for (const p of lowpoly) {
      expect(p.texturePath, p.id).toContain('/models/kenney-')
    }
  })
})

describe('canHaveTexture', () => {
  it('returns true for geometric primitives', () => {
    for (const type of ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule']) {
      expect(canHaveTexture(type), type).toBe(true)
    }
  })

  it('returns false for shader primitives', () => {
    for (const type of ['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora']) {
      expect(canHaveTexture(type), type).toBe(false)
    }
  })

  it('returns false for text', () => {
    expect(canHaveTexture('text')).toBe(false)
  })
})

describe('computeAutoTiling', () => {
  it('returns 1 for a 1m cube with naturalSize 1m', () => {
    expect(computeAutoTiling([1, 1, 1], 1)).toBe(1)
  })

  it('returns 5 for a 10m wall with naturalSize 2m', () => {
    expect(computeAutoTiling([10, 4, 0.3], 2)).toBe(5)
  })

  it('uses the largest dimension', () => {
    expect(computeAutoTiling([0.5, 0.5, 8], 2)).toBe(4)
  })

  it('never returns less than 1', () => {
    expect(computeAutoTiling([0.1, 0.1, 0.1], 5)).toBe(1)
  })

  it('rounds to nearest integer', () => {
    // 3m / 2m = 1.5 → rounds to 2
    expect(computeAutoTiling([3, 1, 1], 2)).toBe(2)
  })
})
