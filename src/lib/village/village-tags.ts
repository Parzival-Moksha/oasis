// ░▒▓ VILLAGE TAGS — what stands over an agent's head: its name, its status word, a quest marker ▓▒░
// Pure: which colour a name is, which marker a status gets, where the pieces sit above the head. The drawing
// is components/village/VillageTags.tsx (3D text, no HTML).

/** What the owner sees over an agent that wants him: like a quest giver in an MMO. */
export type TagMarker = '!' | '?'

/**
 * "!" when the agent has something to tell the owner (it finished and he has not looked, or it is stuck);
 * "?" when it asks him for a decision. Nothing while it works, idles, or after he has looked.
 */
export function tagMarker(status: string | null | undefined, unseen: boolean): TagMarker | null {
  if (status === 'needs-decision') return '?'
  if (status === 'error') return '!'
  if (status === 'waiting' && unseen) return '!'
  return null
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = parseInt(match[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < 1e-6) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/**
 * The colour of an agent's name: its own. If the owner gave its chat a colour (its settings menu), the name
 * takes that hue; otherwise a hue from its name, so it is the same every time. Always bright and saturated
 * enough to read on any background (with the black outline the tag draws around it).
 */
export function agentTagColor(name: string, panelColor?: string | null): string {
  const chosen = panelColor ? hexToHsl(panelColor) : null
  // A grey or near-black chat colour says nothing about hue: fall back to the name.
  const hue = chosen && chosen.s > 0.15 ? chosen.h : hashString(name || 'agent') % 360
  return hslToHex(hue, 0.9, 0.66)
}

/** A darker shade of a colour (the tag's extruded side). */
export function shadeColor(hex: string, factor = 0.42): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return '#222222'
  return hslToHex(hsl.h, hsl.s, hsl.l * factor)
}

/** Text the tag's font can draw: plain Latin letters, digits and common signs; the rest becomes a near look-alike. */
export function tagText(text: string, max = 28): string {
  const plain = text
    .replace(/[×✕]/g, 'x')
    .replace(/[·•]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 3).trimEnd()}...` : plain
}

/** Sizes in metres, measured up from the top of the avatar's body. */
export const TAG = {
  nameSize: 0.17,
  statusSize: 0.1,
  /** The status word's baseline above the head. */
  statusAt: 0.09,
  /** The name's baseline above the head (over the status word). */
  nameAt: 0.25,
  /** The marker's centre above the head (over the name). */
  markerAt: 0.7,
  markerSize: 0.4,
  /** Tags further than this from the camera grow, so a name across the plaza is still readable. */
  growFrom: 9,
  growMax: 2.6,
  /** The top of a body that has not been measured yet. */
  defaultTop: 1.75,
} as const

/** How much a tag at `distance` from the camera is scaled: 1 up close, growing with distance to a cap. */
export function tagScale(distance: number): number {
  if (!(distance > TAG.growFrom)) return 1
  return Math.min(TAG.growMax, distance / TAG.growFrom)
}
