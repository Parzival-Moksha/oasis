import { loadAnimationClip } from './forge/animation-library'

export type PortalTransitionEffect =
  | 'void-iris'
  | 'star-streak'
  | 'glass-shatter'
  | 'clockwork-iris'
  | 'root-tendrils'
  | 'rainbow-vortex'
  | 'wire-wormhole'
  | 'spiral-wormhole'
  | 'broken-wormhole'

export interface PortalTransitionSettings {
  enabled: boolean
  swallowEffect: PortalTransitionEffect
  tunnelEffect: PortalTransitionEffect
  revealEffect: PortalTransitionEffect
  swallowSeconds: number
  tunnelSeconds: number
  revealSeconds: number
  fovBoost: number
  cameraPull: number
  intensity: number
  particleSpeed: number
  shake: number
  rollReveal: boolean
}

export const PORTAL_TRANSITION_EFFECTS: Array<{ id: PortalTransitionEffect; label: string; desc: string }> = [
  { id: 'void-iris', label: 'Void Iris', desc: 'black aperture swallow' },
  { id: 'star-streak', label: 'Star Streak', desc: 'fast HDRI-like tunnel' },
  { id: 'glass-shatter', label: 'Glass Shatter', desc: 'refractive shard break' },
  { id: 'clockwork-iris', label: 'Clock Iris', desc: 'mechanical blackout' },
  { id: 'root-tendrils', label: 'Root Tendrils', desc: 'organic wipe' },
  { id: 'rainbow-vortex', label: 'Rainbow Vortex', desc: 'scene melt color spin' },
  { id: 'wire-wormhole', label: 'Wire Wormhole', desc: 'procedural tube rings' },
  { id: 'spiral-wormhole', label: 'Spiral Wormhole', desc: 'twisting ring tunnel' },
  { id: 'broken-wormhole', label: 'Broken Wormhole', desc: 'chaotic tube collapse' },
]

export const DEFAULT_PORTAL_TRANSITION_SETTINGS: PortalTransitionSettings = {
  enabled: true,
  swallowEffect: 'void-iris',
  tunnelEffect: 'wire-wormhole',
  revealEffect: 'rainbow-vortex',
  swallowSeconds: 0.55,
  tunnelSeconds: 2.2,
  revealSeconds: 0.6,
  fovBoost: 30,
  cameraPull: 1,
  intensity: 1.25,
  particleSpeed: 1.5,
  shake: 0.18,
  rollReveal: true,
}

export const PORTAL_TRANSITION_STORAGE_KEY = 'oasis-portal-transition-vfx'
export const PORTAL_TRANSITION_SETTINGS_EVENT = 'oasis:portal-transition-settings'
export const PORTAL_TRANSITION_START_EVENT = 'oasis:portal-transition:start'
export const PORTAL_REVEAL_ROLL_EVENT = 'oasis:portal-reveal-roll'

const EFFECT_IDS = new Set(PORTAL_TRANSITION_EFFECTS.map(effect => effect.id))

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function effect(value: unknown, fallback: PortalTransitionEffect): PortalTransitionEffect {
  return typeof value === 'string' && EFFECT_IDS.has(value as PortalTransitionEffect)
    ? value as PortalTransitionEffect
    : fallback
}

export function normalizePortalTransitionSettings(input?: Partial<PortalTransitionSettings> | null): PortalTransitionSettings {
  const defaults = DEFAULT_PORTAL_TRANSITION_SETTINGS
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : defaults.enabled,
    swallowEffect: effect(input?.swallowEffect, defaults.swallowEffect),
    tunnelEffect: effect(input?.tunnelEffect, defaults.tunnelEffect),
    revealEffect: effect(input?.revealEffect, defaults.revealEffect),
    swallowSeconds: clamp(input?.swallowSeconds, 0.15, 1.5, defaults.swallowSeconds),
    tunnelSeconds: clamp(input?.tunnelSeconds, 0.4, 4.5, defaults.tunnelSeconds),
    revealSeconds: clamp(input?.revealSeconds, 0.15, 1.75, defaults.revealSeconds),
    fovBoost: clamp(input?.fovBoost, 0, 45, defaults.fovBoost),
    cameraPull: clamp(input?.cameraPull, 0, 1.6, defaults.cameraPull),
    intensity: clamp(input?.intensity, 0.25, 2.5, defaults.intensity),
    particleSpeed: clamp(input?.particleSpeed, 0.25, 3.5, defaults.particleSpeed),
    shake: clamp(input?.shake, 0, 0.7, defaults.shake),
    rollReveal: typeof input?.rollReveal === 'boolean' ? input.rollReveal : defaults.rollReveal,
  }
}

export function readPortalTransitionSettings(): PortalTransitionSettings {
  if (typeof window === 'undefined') return DEFAULT_PORTAL_TRANSITION_SETTINGS
  try {
    const raw = window.localStorage.getItem(PORTAL_TRANSITION_STORAGE_KEY)
    if (!raw) return DEFAULT_PORTAL_TRANSITION_SETTINGS
    return normalizePortalTransitionSettings(JSON.parse(raw) as Partial<PortalTransitionSettings>)
  } catch {
    return DEFAULT_PORTAL_TRANSITION_SETTINGS
  }
}

export function writePortalTransitionSettings(settings: PortalTransitionSettings): PortalTransitionSettings {
  const next = normalizePortalTransitionSettings(settings)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PORTAL_TRANSITION_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_SETTINGS_EVENT, { detail: next }))
  }
  return next
}

export function patchPortalTransitionSettings(patch: Partial<PortalTransitionSettings>): PortalTransitionSettings {
  return writePortalTransitionSettings({ ...readPortalTransitionSettings(), ...patch })
}

export function subscribePortalTransitionSettings(listener: (settings: PortalTransitionSettings) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onSettings = (event: Event) => {
    listener(normalizePortalTransitionSettings((event as CustomEvent<Partial<PortalTransitionSettings>>).detail))
  }
  window.addEventListener(PORTAL_TRANSITION_SETTINGS_EVENT, onSettings)
  return () => window.removeEventListener(PORTAL_TRANSITION_SETTINGS_EVENT, onSettings)
}

let rollPreloadPromise: Promise<boolean> | null = null

export function preloadPortalRevealRoll(): Promise<boolean> {
  if (!rollPreloadPromise) {
    rollPreloadPromise = loadAnimationClip('ual-roll')
      .then(clip => Boolean(clip))
      .catch(error => {
        console.warn('[portal-transition] Failed to preload ual-roll:', error)
        rollPreloadPromise = null
        return false
      })
  }
  return rollPreloadPromise
}
