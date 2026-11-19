import { describe, expect, it } from 'vitest'

import { DEFAULT_LOOK, clampLook, hexToRgb, panelStyle } from '../village/panel-look'

describe('panel look', () => {
  it('keeps transparency and blur in range', () => {
    expect(clampLook({ opacity: 0, blur: 99 })).toEqual({ opacity: 0.05, blur: 24 })
    expect(clampLook({ opacity: 2, blur: -3 })).toEqual({ opacity: 1, blur: 0 })
    expect(clampLook(null)).toEqual(DEFAULT_LOOK)
    expect(clampLook({ opacity: Number.NaN })).toEqual(DEFAULT_LOOK)
  })

  it('reads hex colours', () => {
    expect(hexToRgb('#1a0b2e')).toEqual([26, 11, 46])
    expect(hexToRgb('fff')).toEqual([255, 255, 255])
    expect(hexToRgb('red')).toBeNull()
  })

  it('builds the background from the colour and opacity, and the blur', () => {
    const style = panelStyle('#204060', { opacity: 0.5, blur: 10 })
    expect(style.background).toBe('linear-gradient(160deg, rgba(32,64,96,0.5) 0%, rgba(18,35,53,0.54) 100%)')
    expect(style.backdropFilter).toBe('blur(10px)')
    expect(panelStyle(null, { opacity: 1, blur: 0 }).backdropFilter).toBe('none')
  })

  it('falls back to the default colour', () => {
    expect(panelStyle('nonsense', { opacity: 1, blur: 0 }).background).toContain('rgba(7,12,24,1)')
  })
})
