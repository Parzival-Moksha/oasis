// The one look of every menu in the Oasis (the UI kit, src/components/ui-kit). Owned by Hipster.
//
// The owner, 2026-11-19 (45:30): "the real Oasis will have an option for both… do you want a texture behind
// your menus, or do you want just blur and transparency… one big setting [that] will flip every menu."
// So: one style for all menus (glass, or a textured set), and for glass its blur, see-through and colour.
// Kit components read this; a menu built with the kit changes with it and needs no code of its own.

import { useSyncExternalStore } from 'react'

export type MenuStyleId = 'glass' | 'forged' | 'parchment' | 'rune'

export const MENU_STYLES: Array<{ id: MenuStyleId; label: string; blurb: string }> = [
  { id: 'glass', label: 'Glass', blurb: 'See-through with blur on a colour you pick. The world stays visible.' },
  { id: 'forged', label: 'Forged', blurb: 'Jewelled iron frames, stone plates, gold letters. The spell book\'s material.' },
  { id: 'parchment', label: 'Parchment', blurb: 'Painted parchment in carved frames, ink lettering.' },
  { id: 'rune', label: 'Rune', blurb: 'Bronze-edged dark tablets, serif small capitals.' },
]

export type ToggleLookId = 'gem' | 'lever' | 'flip' | 'plate' | 'slide'

/** Switch designs (the owner, 2026-11-20: toggles "look so noob, so web… give me a couple of other options"). */
export const TOGGLE_LOOKS: Array<{ id: ToggleLookId; label: string; blurb: string }> = [
  { id: 'gem', label: 'Gem socket', blurb: 'An iron socket; on, an emerald glows in it. Off, the socket is empty.' },
  { id: 'lever', label: 'Rune lever', blurb: 'A brass lever that throws over; on, the rune under it lights.' },
  { id: 'flip', label: 'Flip switch', blurb: 'A machine switch on a riveted plate, up for on, with a lamp.' },
  { id: 'plate', label: 'Check plate', blurb: 'A small framed stone; on, a gold check is set in it.' },
  { id: 'slide', label: 'Slide', blurb: 'The sliding switch of before, in the menu style.' },
]

export interface MenuLook {
  style: MenuStyleId
  /** The switch design of every toggle in the Oasis. */
  toggle: ToggleLookId
  /** Glass: backdrop blur in CSS pixels. */
  blur: number
  /** Glass: 0 = solid, 100 = fully see-through. */
  transparency: number
  /** Glass: the colour behind the text, #rrggbb. */
  color: string
}

/** Defaults from the owner's walk-through: 75% / blur 5 at 15:17, revised at 42:39 to "default 90 transparency… blur of four". */
export const DEFAULT_MENU_LOOK: MenuLook = { style: 'forged', toggle: 'gem', blur: 4, transparency: 90, color: '#1f2125' }
export const MENU_BLUR_MAX = 24
export const MENU_SWATCHES = ['#1f2125', '#0b0c10', '#2a2d34', '#141a2a', '#1d1430', '#122326', '#2b1518', '#1a2416', '#2a2216', '#3a3f4a']

const KEY = 'oasis-menu-look'
const OLD_KEY = 'oasis-settings-look'

export function sanitizeMenuLook(raw: unknown): MenuLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
  return {
    style: MENU_STYLES.some(s => s.id === r.style) ? (r.style as MenuStyleId) : DEFAULT_MENU_LOOK.style,
    toggle: TOGGLE_LOOKS.some(t => t.id === r.toggle) ? (r.toggle as ToggleLookId) : DEFAULT_MENU_LOOK.toggle,
    blur: num(r.blur, 0, MENU_BLUR_MAX, DEFAULT_MENU_LOOK.blur),
    transparency: num(r.transparency, 0, 100, DEFAULT_MENU_LOOK.transparency),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : DEFAULT_MENU_LOOK.color,
  }
}

/** Background colour (with its see-through) and backdrop filter of a glass surface. */
export function glassStyle(look: Pick<MenuLook, 'blur' | 'transparency' | 'color'>): { backgroundColor: string; backdropFilter: string; WebkitBackdropFilter: string } {
  const r = parseInt(look.color.slice(1, 3), 16)
  const g = parseInt(look.color.slice(3, 5), 16)
  const b = parseInt(look.color.slice(5, 7), 16)
  const alpha = Math.round((1 - look.transparency / 100) * 1000) / 1000
  const filter = look.blur > 0 ? `blur(${look.blur}px)` : 'none'
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`, backdropFilter: filter, WebkitBackdropFilter: filter }
}

let current: MenuLook | null = null
const listeners = new Set<() => void>()

/** Kit CSS reads these from the page root, so even plain CSS can follow the look. */
function publish(look: MenuLook) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const glass = glassStyle(look)
  root.dataset.menuStyle = look.style
  root.style.setProperty('--kit-glass-bg', glass.backgroundColor)
  root.style.setProperty('--kit-glass-blur', glass.backdropFilter)
}

export function getMenuLook(): MenuLook {
  if (current) return current
  if (typeof window === 'undefined') return DEFAULT_MENU_LOOK
  try {
    const saved = window.localStorage.getItem(KEY)
    // The owner's Settings-only look of 2026-11-19 carries over (its blur, see-through and colour).
    current = sanitizeMenuLook(saved ? JSON.parse(saved) : JSON.parse(window.localStorage.getItem(OLD_KEY) || '{}'))
  } catch {
    current = DEFAULT_MENU_LOOK
  }
  publish(current)
  return current
}

export function setMenuLook(patch: Partial<MenuLook>): void {
  current = sanitizeMenuLook({ ...getMenuLook(), ...patch })
  try { window.localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private mode */ }
  publish(current)
  listeners.forEach(fn => fn())
}

export function subscribeMenuLook(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useMenuLook(): MenuLook {
  return useSyncExternalStore(subscribeMenuLook, getMenuLook, () => DEFAULT_MENU_LOOK)
}
