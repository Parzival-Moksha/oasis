// ░▒▓ GRAPHICS PREFS — looks settings that cost (or save) frame time ▓▒░
// Ground sharpness and sun shadows, picked in Config → Graphics. Kept in their own small store
// (localStorage `oasis-graphics-prefs`) so that renderers deep in the canvas can read them
// without the settings context, and code outside React can read them too.

export type GroundSharpness = 1 | 2 | 4
export type ShadowMode = 'off' | 'avatars' | 'all'
export type ShadowQuality = 'low' | 'medium' | 'high'
/** 'auto': every frame while something in range moves, 60 times a second otherwise. */
export type ShadowRefresh = 'auto' | 'frame' | '60' | '30'
/** Flop saver (src/lib/flop-saver.ts): auto, everything on, or saver. */
export type FlopSaverMode = 'auto' | 'all' | 'saver'

export interface GraphicsPrefs {
  /** Ground texel density against the original look: 1 (as before), 2 or 4 times sharper. */
  groundSharpness: GroundSharpness
  /** Sun shadows: none, the avatars only, or avatars and world objects. */
  shadows: ShadowMode
  /** Shadow map resolution: 1024, 2048 or 4096 px over the same 64 m. */
  shadowQuality: ShadowQuality
  /** How blurred the shadow's edge is: 0 (crisp) to 1 (very soft). */
  shadowSoftness: number
  /** How dark a shadow is: 0 (only the sun's own light is blocked) to 1 (nearly black). */
  shadowStrength: number
  /** How often the shadow map is redrawn. */
  shadowRefresh: ShadowRefresh
  /** Effects switch off by tiers while the frame rate stays under 30 (auto), never (all), or always (saver). */
  flopSaver: FlopSaverMode
}

export const GRAPHICS_PREFS_DEFAULT: GraphicsPrefs = {
  groundSharpness: 2, shadows: 'avatars', shadowQuality: 'high', shadowSoftness: 0.5, shadowStrength: 0.5, shadowRefresh: 'auto', flopSaver: 'auto',
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

const STORAGE_KEY = 'oasis-graphics-prefs'

/** Whatever was saved, made valid: unknown values fall back to the defaults. */
export function normalizeGraphicsPrefs(raw: unknown): GraphicsPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GraphicsPrefs, unknown>>
  const sharpness = value.groundSharpness
  const shadows = value.shadows
  const quality = value.shadowQuality
  const refresh = value.shadowRefresh
  const flop = value.flopSaver
  return {
    flopSaver: flop === 'auto' || flop === 'all' || flop === 'saver' ? flop : GRAPHICS_PREFS_DEFAULT.flopSaver,
    shadowQuality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : GRAPHICS_PREFS_DEFAULT.shadowQuality,
    shadowSoftness: unit(value.shadowSoftness, GRAPHICS_PREFS_DEFAULT.shadowSoftness),
    shadowStrength: unit(value.shadowStrength, GRAPHICS_PREFS_DEFAULT.shadowStrength),
    shadowRefresh: refresh === 'auto' || refresh === 'frame' || refresh === '60' || refresh === '30' ? refresh : GRAPHICS_PREFS_DEFAULT.shadowRefresh,
    groundSharpness: sharpness === 1 || sharpness === 2 || sharpness === 4 ? sharpness : GRAPHICS_PREFS_DEFAULT.groundSharpness,
    shadows: shadows === 'off' || shadows === 'avatars' || shadows === 'all' ? shadows : GRAPHICS_PREFS_DEFAULT.shadows,
  }
}

function load(): GraphicsPrefs {
  if (typeof window === 'undefined') return GRAPHICS_PREFS_DEFAULT
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return normalizeGraphicsPrefs(saved ? JSON.parse(saved) : null)
  } catch {
    return GRAPHICS_PREFS_DEFAULT
  }
}

let prefs: GraphicsPrefs | null = null
const listeners = new Set<() => void>()

export function getGraphicsPrefs(): GraphicsPrefs {
  if (!prefs) prefs = load()
  return prefs
}

export function setGraphicsPref<K extends keyof GraphicsPrefs>(key: K, value: GraphicsPrefs[K]): void {
  const next = normalizeGraphicsPrefs({ ...getGraphicsPrefs(), [key]: value })
  if (next[key] === getGraphicsPrefs()[key]) return
  prefs = next
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode: keep it for the session */ }
  listeners.forEach(listener => listener())
}

export function subscribeGraphicsPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Server render and first paint use the defaults. */
export function getServerGraphicsPrefs(): GraphicsPrefs {
  return GRAPHICS_PREFS_DEFAULT
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisGraphics = {
    get: () => getGraphicsPrefs(),
    set: (key: keyof GraphicsPrefs, value: never) => setGraphicsPref(key, value),
  }
}
