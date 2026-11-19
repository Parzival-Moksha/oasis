// ░▒▓ NAME TAG STYLE — how the name over an agent's head is drawn, and how big ▓▒░
// Kept in this browser (localStorage), like the other village looks; chosen in Settings > Agents.

export type TagStyle = 'outline' | 'extruded'

export const TAG_STYLES: Array<{ id: TagStyle; label: string; hint: string }> = [
  { id: 'extruded', label: '3D letters', hint: 'Real solid letters with a bevelled edge; their sides 2.6 times darker than their faces.' },
  { id: 'outline', label: 'Outlined', hint: 'Flat letters with a true outline (troika text, crisp at any distance).' },
]

/** A multiplier on the drawn size. 1 was the first size; the owner (2026-11-19) wanted about half by default. */
export const TAG_SIZE = { min: 0.25, max: 2, default: 0.5 } as const
export const TAG_STYLE_DEFAULT: TagStyle = 'extruded'

export interface TagSettings {
  style: TagStyle
  /** A multiplier on the tag's drawn size (name, status word and marker). */
  size: number
  /**
   * The T / E / F keys also as a banner at the bottom of the screen (as before 2026-11-19). Off by default: they
   * show over the agent in the world now.
   */
  keysAtBottom: boolean
}

// v2 (2026-11-19): the layered and crazy styles are gone (they read as the default) and the default size halved;
// a size saved under v1 belonged to the old scale, so only v1's style is carried over.
const KEY = 'oasis.village.tagStyle.v2'
const OLD_KEY = 'oasis.village.tagStyle.v1'

export function isTagStyle(value: unknown): value is TagStyle {
  return value === 'outline' || value === 'extruded'
}

export function clampTagSettings(raw: Partial<TagSettings> | null | undefined): TagSettings {
  const size = typeof raw?.size === 'number' && Number.isFinite(raw.size) ? raw.size : TAG_SIZE.default
  return {
    style: isTagStyle(raw?.style) ? raw.style : TAG_STYLE_DEFAULT,
    size: Math.min(TAG_SIZE.max, Math.max(TAG_SIZE.min, Math.round(size * 20) / 20)),
    keysAtBottom: raw?.keysAtBottom === true,
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
      if (!raw) {
        try {
          const old = JSON.parse(window.localStorage.getItem(OLD_KEY) || 'null') as Partial<TagSettings> | null
          if (old && isTagStyle(old.style)) raw = { style: old.style }
        } catch { /* nothing to carry over */ }
      }
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
