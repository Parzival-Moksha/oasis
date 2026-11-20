// ░▒▓ PANEL LOOK — how agent chats look: the side panel (E) and the full screen (F) ▓▒░
// Transparency and blur are one setting for every agent; the background colour is per agent (its
// session). Kept in this browser (localStorage), like the old Oasis's defaults for agent windows.
//
// One colour per agent, its accent: the same for its name tag, its marker's rim, the border of its panel and
// the dark background of its chat (derived from it). Random at first (a hue from its key), changeable.

import { accentBackground, defaultAccent } from './village-tags'
import { fieldMap } from './village-identity'
import { getVillageIdentity, isVillageIdentityOffline, isVillageIdentityReady, queueVillageIdentity, subscribeVillageIdentity } from './village-identity-client'

export interface PanelLook {
  /** Background opacity, 0.15 (see-through) to 1 (solid). */
  opacity: number
  /** Backdrop blur in px, 0 to 24. */
  blur: number
}

// The owner (2026-11-19, 42:27): 90% see-through and blur 4 for the agent panel and screen by default.
export const DEFAULT_LOOK: PanelLook = { opacity: 0.1, blur: 4 }
export const DEFAULT_PANEL_COLOR = '#070c18'
export const PANEL_SWATCHES = ['#070c18', '#1a0b2e', '#062019', '#2a0f0f', '#0d1f33', '#24180a', '#141414', '#2b1a33']

// v2: the new default (2026-11-19) for everyone; a look saved before starts again from it.
const LOOK_KEY = 'oasis.village.panelLook.v2'
const COLORS_KEY = 'oasis.village.panelColors.v1'
const ACCENT_KEY = 'oasis.village.accentColors.v1'

export function clampLook(look: Partial<PanelLook> | null | undefined): PanelLook {
  const opacity = typeof look?.opacity === 'number' && Number.isFinite(look.opacity) ? look.opacity : DEFAULT_LOOK.opacity
  const blur = typeof look?.blur === 'number' && Number.isFinite(look.blur) ? look.blur : DEFAULT_LOOK.blur
  return { opacity: Math.min(1, Math.max(0.05, opacity)), blur: Math.min(24, Math.max(0, Math.round(blur))) }
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** CSS for a chat surface: a top-left to bottom-right fade of the colour, at the chosen opacity, and the blur. */
export function panelStyle(color: string | null | undefined, look: PanelLook): { background: string; backdropFilter: string; WebkitBackdropFilter: string } {
  const [r, g, b] = hexToRgb(color || '') || hexToRgb(DEFAULT_PANEL_COLOR)!
  const dark = (v: number) => Math.round(v * 0.55)
  const a1 = look.opacity
  const a2 = Math.min(1, look.opacity + 0.04)
  const filter = look.blur > 0 ? `blur(${look.blur}px)` : 'none'
  return {
    background: `linear-gradient(160deg, rgba(${r},${g},${b},${a1}) 0%, rgba(${dark(r)},${dark(g)},${dark(b)},${a2}) 100%)`,
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
  }
}

// ─── this browser's settings ──────────────────────────────────────────────────

const listeners = new Set<() => void>()
let version = 0
let lookCache: PanelLook | null = null
let colorsCache: Record<string, string> | null = null
let accentCache: Record<string, string> | null = null

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(window.localStorage.getItem(key) || 'null') as T } catch { return null }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked */ }
}

function changed(): void {
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribePanelLook(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPanelLookVersion(): number {
  return version
}

export function getPanelLook(): PanelLook {
  lookCache ??= clampLook(read<Partial<PanelLook>>(LOOK_KEY))
  return lookCache
}

export function setPanelLook(patch: Partial<PanelLook>): void {
  lookCache = clampLook({ ...getPanelLook(), ...patch })
  write(LOOK_KEY, lookCache)
  changed()
}

/** Accent colours live in the store on this PC (village-identity.ts) once it is loaded: the same in every window. */
function storedAccents(): Record<string, string> | null {
  const file = isVillageIdentityReady() && !isVillageIdentityOffline() ? getVillageIdentity() : null
  return file ? fieldMap(file, 'accent') : null
}

subscribeVillageIdentity(() => {
  const stored = storedAccents()
  if (!stored || JSON.stringify(stored) === JSON.stringify(accentCache)) return
  accentCache = stored
  changed()
})

/** The agent's colour: the owner's pick, else its starting one (the hue of an old chat colour, or one from its key). */
export function getAgentAccent(key: string): string {
  accentCache ??= storedAccents() || read<Record<string, string>>(ACCENT_KEY) || {}
  if (accentCache[key]) return accentCache[key]
  colorsCache ??= read<Record<string, string>>(COLORS_KEY) || {}
  return defaultAccent(key, colorsCache[key] || null)
}

/** null: back to its starting colour. */
export function setAgentAccent(key: string, color: string | null): void {
  accentCache ??= storedAccents() || read<Record<string, string>>(ACCENT_KEY) || {}
  const next = { ...accentCache }
  if (color && hexToRgb(color)) next[key] = color
  else delete next[key]
  accentCache = next
  queueVillageIdentity([{ agent: key, set: { accent: next[key] ?? null } }])
  write(ACCENT_KEY, next)
  changed()
}

/** The dark background of its chat surfaces, from its accent. */
export function getAgentPanelColor(key: string): string {
  return accentBackground(getAgentAccent(key))
}
