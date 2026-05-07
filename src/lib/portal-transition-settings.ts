import { loadAnimationClip } from './forge/animation-library'

export type PortalTransitionEffect =
  | 'none'
  | 'void-iris'
  | 'black-hole-pinch'
  | 'glass-shatter'
  | 'prism-burst'
  | 'wireframe-wormhole'
  | 'cosmic-wormhole'
  | 'plasma-wormhole'
  | 'datawave-wormhole'
  | 'bobbyroe-wormhole'
  | 'infinite-tubes'
  | 'wormhole-extreme'
  | 'tsl-vortex'

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
  // ─── WebGL wormhole tuning ──────────────────────────────────────────────
  // Apply only to bobbyroe / infinite-tubes / wormhole-extreme / tsl-vortex.
  // CSS variants (wireframe/cosmic/plasma/datawave) ignore them.
  wormholeHue: number          // 0..1
  wormholeNoiseAmp: number     // 0..1.5 — how chunky the bobbyroe walls are
  wormholeRadius: number       // 1..6 — tunnel radius for tube variants
  wormholeBob: number          // 0..3 — camera sway amplitude
}

export const PORTAL_TRANSITION_EFFECTS: Array<{ id: PortalTransitionEffect; label: string; desc: string }> = [
  { id: 'none', label: '— None —', desc: 'no overlay; camera animation still runs' },
  { id: 'void-iris', label: 'Void Iris', desc: 'swallow · black aperture' },
  { id: 'black-hole-pinch', label: 'Black Hole Pinch', desc: 'swallow · gravity well + accretion ring' },
  { id: 'glass-shatter', label: 'Glass Shatter', desc: 'reveal · refractive shard break' },
  { id: 'prism-burst', label: 'Prism Burst', desc: 'reveal · chromatic flare' },
  { id: 'wireframe-wormhole', label: 'Wireframe Wormhole', desc: 'tunnel · neon Tron grid tube (CSS)' },
  { id: 'cosmic-wormhole', label: 'Cosmic Wormhole', desc: 'tunnel · nebula + hyperjump streaks (CSS)' },
  { id: 'plasma-wormhole', label: 'Plasma Wormhole', desc: 'tunnel · electric arc conduit (CSS)' },
  { id: 'datawave-wormhole', label: 'Datawave Wormhole', desc: 'tunnel · matrix glitch corridor (CSS)' },
  { id: 'bobbyroe-wormhole', label: 'Bobbyroe Wormhole', desc: 'tunnel · WebGL noise-displaced star tube' },
  { id: 'infinite-tubes', label: 'Infinite Tubes', desc: 'tunnel · WebGL textured tube w/ scrolling UVs' },
  { id: 'wormhole-extreme', label: 'Wormhole Extreme', desc: 'tunnel · WebGL warp+nebula tunnel' },
  { id: 'tsl-vortex', label: 'TSL Vortex', desc: 'tunnel · WebGL procedural vortex shader' },
]

export const DEFAULT_PORTAL_TRANSITION_SETTINGS: PortalTransitionSettings = {
  enabled: true,
  swallowEffect: 'none',
  tunnelEffect: 'bobbyroe-wormhole',
  revealEffect: 'prism-burst',
  swallowSeconds: 0.55,
  tunnelSeconds: 2.2,
  revealSeconds: 0.6,
  fovBoost: 30,
  cameraPull: 1,
  intensity: 1.25,
  particleSpeed: 1.5,
  shake: 0.18,
  rollReveal: true,
  wormholeHue: 0.55,
  wormholeNoiseAmp: 0.5,
  wormholeRadius: 3,
  wormholeBob: 1.5,
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
    wormholeHue: clamp(input?.wormholeHue, 0, 1, defaults.wormholeHue),
    wormholeNoiseAmp: clamp(input?.wormholeNoiseAmp, 0, 1.5, defaults.wormholeNoiseAmp),
    wormholeRadius: clamp(input?.wormholeRadius, 1, 6, defaults.wormholeRadius),
    wormholeBob: clamp(input?.wormholeBob, 0, 3, defaults.wormholeBob),
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
