// The Settings menu's own backdrop: how much it blurs the world behind it, how see-through it is, its colour.
// Picked with the three small controls in the top right of the Settings menu, kept in localStorage.
// Defaults from the owner (2026-11-19): blur 4, transparency 30%, dark grey.

import { useSyncExternalStore } from 'react'

export interface SettingsLook {
  /** Backdrop blur, CSS pixels. */
  blur: number
  /** 0 = solid, 100 = fully see-through (only the blur is left). */
  transparency: number
  /** #rrggbb */
  color: string
}

export const DEFAULT_SETTINGS_LOOK: SettingsLook = { blur: 4, transparency: 30, color: '#1f2125' }
export const SETTINGS_BLUR_MAX = 24

/** A few colours that sit well behind white text; the picker offers these first. */
export const SETTINGS_SWATCHES = ['#1f2125', '#0b0c10', '#2a2d34', '#141a2a', '#1d1430', '#122326', '#2b1518', '#1a2416', '#2a2216', '#3a3f4a']

const KEY = 'oasis-settings-look'

export function sanitizeSettingsLook(raw: unknown): SettingsLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
  const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : DEFAULT_SETTINGS_LOOK.color
  return {
    blur: num(r.blur, 0, SETTINGS_BLUR_MAX, DEFAULT_SETTINGS_LOOK.blur),
    transparency: num(r.transparency, 0, 100, DEFAULT_SETTINGS_LOOK.transparency),
    color,
  }
}

/** The panel's background and backdrop filter for a look. */
export function settingsLookStyle(look: SettingsLook): { backgroundColor: string; backdropFilter: string; WebkitBackdropFilter: string } {
  const r = parseInt(look.color.slice(1, 3), 16)
  const g = parseInt(look.color.slice(3, 5), 16)
  const b = parseInt(look.color.slice(5, 7), 16)
  const alpha = Math.round((1 - look.transparency / 100) * 1000) / 1000
  const filter = look.blur > 0 ? `blur(${look.blur}px)` : 'none'
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`, backdropFilter: filter, WebkitBackdropFilter: filter }
}

let current: SettingsLook | null = null
const listeners = new Set<() => void>()

export function getSettingsLook(): SettingsLook {
  if (current) return current
  if (typeof window === 'undefined') return DEFAULT_SETTINGS_LOOK
  try { current = sanitizeSettingsLook(JSON.parse(window.localStorage.getItem(KEY) || '{}')) } catch { current = DEFAULT_SETTINGS_LOOK }
  return current
}

export function setSettingsLook(patch: Partial<SettingsLook>): void {
  current = sanitizeSettingsLook({ ...getSettingsLook(), ...patch })
  try { window.localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private mode */ }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useSettingsLook(): SettingsLook {
  return useSyncExternalStore(subscribe, getSettingsLook, () => DEFAULT_SETTINGS_LOOK)
}
