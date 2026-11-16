import { describe, expect, it } from 'vitest'

import { groundAnisotropy, groundDetailScale, groundTexelsPerMetre, paintedCellRepeat, GROUND_DETAIL_MAP_FRAGMENT } from '../ground-sharpness'
import { GRAPHICS_PREFS_DEFAULT, normalizeGraphicsPrefs } from '../../graphics-prefs'

describe('ground sharpness', () => {
  it('at 1 everything is as it was: no anisotropy, no detail layer, one image per painted cell', () => {
    expect(groundAnisotropy(1, 16)).toBe(1)
    expect(groundDetailScale(1)).toBe(1)
    expect(paintedCellRepeat(4, 1)).toBe(1)
  })

  it('sharper settings use the GPU maximum anisotropy, whatever it is', () => {
    expect(groundAnisotropy(2, 16)).toBe(16)
    expect(groundAnisotropy(4, 8)).toBe(8)
    expect(groundAnisotropy(4, 0)).toBe(1)
  })

  it('a stretched painted cell repeats the texture up to the sharpness, never finer than one image a metre', () => {
    expect(paintedCellRepeat(4, 2)).toBe(2)
    expect(paintedCellRepeat(4, 4)).toBe(4)
    expect(paintedCellRepeat(2, 4)).toBe(2)
    expect(paintedCellRepeat(1, 4)).toBe(1)
    expect(paintedCellRepeat(Number.NaN, 4)).toBe(1)
    expect(paintedCellRepeat(0, 4)).toBe(1)
  })

  it('the grass ground (1024 px, 8 repeats over 100 m) goes from 82 px a metre to 164 and 328', () => {
    expect(Math.round(groundTexelsPerMetre(1024, 8, 100, 1))).toBe(82)
    expect(Math.round(groundTexelsPerMetre(1024, 8, 100, 2))).toBe(164)
    expect(Math.round(groundTexelsPerMetre(1024, 8, 100, 4))).toBe(328)
  })

  it('the shader piece keeps three\'s names, so it can stand in for map_fragment', () => {
    for (const name of ['USE_MAP', 'sampledDiffuseColor', 'vMapUv', 'diffuseColor *= sampledDiffuseColor', 'uGroundDetail', 'uGroundDetailStrength']) {
      expect(GROUND_DETAIL_MAP_FRAGMENT).toContain(name)
    }
  })
})

describe('graphics prefs', () => {
  it('fills in defaults and drops values it does not know', () => {
    expect(normalizeGraphicsPrefs(null)).toEqual(GRAPHICS_PREFS_DEFAULT)
    expect(normalizeGraphicsPrefs({ groundSharpness: 3, shadows: 'ultra' })).toEqual(GRAPHICS_PREFS_DEFAULT)
    expect(normalizeGraphicsPrefs({ groundSharpness: 4, shadows: 'all' })).toEqual({ groundSharpness: 4, shadows: 'all' })
    expect(normalizeGraphicsPrefs({ shadows: 'off' })).toEqual({ ...GRAPHICS_PREFS_DEFAULT, shadows: 'off' })
  })
})
