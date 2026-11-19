// Every light slider in the Environment page reads 0 to 1 (the owner, 2026-11-19 walkthrough 0:37).
// 1 is the brightest value that still looks right; the raw ranges went far past that
// (environment light was too bright above 5 of 50, the sun above about 50 of 500).
// The curve is squared, so the low end, where most good looks live, gets most of the slider.

import type { WorldLightType } from '@/lib/conjure/types'

/** The raw intensity a slider at 1 gives, per light type. */
export const LIGHT_USABLE_MAX: Record<WorldLightType, number> = {
  environment: 5,
  directional: 50,
  ambient: 4,
  hemisphere: 10,
  point: 300,
  spot: 1500,
}

/** Bright daylight skies light the scene much more than night skies: their environment light tops out lower. */
const BRIGHT_SKIES = new Set(['clear_day', 'clear_day_sky', 'pastel_dawn', 'alps_field', 'autumn_ground', 'sunny_vondelpark', 'outdoor_umbrellas', 'stadium', 'city', 'park', 'studio', 'dawn', 'forest', 'sunset'])
const DARK_SKIES = new Set(['stars', 'night001', 'night004', 'night007', 'night008', 'night_preset', 'aurora_night', 'aurora_night_sky'])

/** The raw maximum for this light under this sky. */
export function usableMax(type: WorldLightType, skyId?: string | null): number {
  const base = LIGHT_USABLE_MAX[type]
  if (type !== 'environment' || !skyId) return base
  if (BRIGHT_SKIES.has(skyId)) return 3
  if (DARK_SKIES.has(skyId)) return 8
  return base
}

/** Raw intensity → slider position 0..1. */
export function intensityToSlider(type: WorldLightType, intensity: number, skyId?: string | null): number {
  const max = usableMax(type, skyId)
  if (!Number.isFinite(intensity) || intensity <= 0) return 0
  return Math.min(1, Math.sqrt(intensity / max))
}

/** Slider position 0..1 → raw intensity. */
export function sliderToIntensity(type: WorldLightType, position: number, skyId?: string | null): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0))
  const raw = usableMax(type, skyId) * p * p
  return Math.round(raw * 1000) / 1000
}
