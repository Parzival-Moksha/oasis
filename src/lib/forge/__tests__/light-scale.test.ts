import { describe, expect, it } from 'vitest'
import { intensityToSlider, sliderToIntensity, usableMax } from '../light-scale'

describe('light-scale', () => {
  it('maps 1 to the usable maximum and 0 to off', () => {
    expect(sliderToIntensity('environment', 1)).toBe(5)
    expect(sliderToIntensity('directional', 1)).toBe(50)
    expect(sliderToIntensity('ambient', 0)).toBe(0)
  })

  it('round-trips', () => {
    for (const p of [0.1, 0.33, 0.5, 0.9]) {
      expect(intensityToSlider('directional', sliderToIntensity('directional', p))).toBeCloseTo(p, 2)
    }
  })

  it('clamps values past the usable range to 1', () => {
    expect(intensityToSlider('environment', 50)).toBe(1)
    expect(intensityToSlider('directional', 400)).toBe(1)
  })

  it('handles junk', () => {
    expect(intensityToSlider('ambient', Number.NaN)).toBe(0)
    expect(sliderToIntensity('ambient', Number.NaN)).toBe(0)
    expect(sliderToIntensity('ambient', 3)).toBe(4)
  })

  it('gives bright skies a lower environment ceiling than night skies', () => {
    expect(usableMax('environment', 'clear_day')).toBeLessThan(usableMax('environment', 'night007'))
    expect(usableMax('directional', 'clear_day')).toBe(50)
  })
})
