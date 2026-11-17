// ░▒▓ NAME TAG STYLE — how the name over an agent's head is drawn, and how big ▓▒░
// Kept in this browser (localStorage), like the other village looks; chosen in Settings > Agents.

export type TagStyle = 'outline' | 'layered' | 'extruded' | 'crazy'

export const TAG_STYLES: Array<{ id: TagStyle; label: string; hint: string }> = [
  { id: 'outline', label: 'Outlined', hint: 'Flat letters with a true outline (troika text, crisp at any distance). Cheapest to look at.' },
  { id: 'layered', label: 'Layered', hint: 'The first look: flat letters with a darker copy stepped behind, and a black outline copy.' },
  { id: 'extruded', label: '3D letters', hint: 'Real solid letters with a bevelled edge. The name sways a little so the depth shows.' },
  { id: 'crazy', label: 'Crazy', hint: 'Solid calligraphic letters on a wave, shading through the colours of the agent.' },
]

export const TAG_SIZE = { min: 0.5, max: 2.5, default: 1 } as const
export const TAG_STYLE_DEFAULT: TagStyle = 'extruded'

export interface TagSettings {
  style: TagStyle
  /** A multiplier on the tag's drawn size (name, status word and marker). */
  size: number
}

const KEY = 'oasis.village.tagStyle.v1'

export function isTagStyle(value: unknown): value is TagStyle {
  return value === 'outline' || value === 'layered' || value === 'extruded' || value === 'crazy'
}

export function clampTagSettings(raw: Partial<TagSettings> | null | undefined): TagSettings {
  const size = typeof raw?.size === 'number' && Number.isFinite(raw.size) ? raw.size : TAG_SIZE.default
  return {
    style: isTagStyle(raw?.style) ? raw.style : TAG_STYLE_DEFAULT,
    size: Math.min(TAG_SIZE.max, Math.max(TAG_SIZE.min, Math.round(size * 20) / 20)),
  }
}

const listeners = new Set<() => void>()
let version = 0
let cache: TagSettings | null = null

export function getTagSettings(): TagSettings {
  if (!cache) {
    let raw: Partial<TagSettings> | null = null
    if (typeof window !== 'undefined') {
      try { raw = JSON.parse(window.localStorage.getItem(KEY) || 'null') } catch { raw = null }
    }
    cache = clampTagSettings(raw)
  }
  return cache
}

export function setTagSettings(patch: Partial<TagSettings>): void {
  cache = clampTagSettings({ ...getTagSettings(), ...patch })
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* storage blocked */ }
  }
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribeTagSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getTagSettingsVersion(): number {
  return version
}
