// The look of the always-on HUD rail (Menu, World, Spells, Agents): one complete design per look
// (shape, border, typeface, hover), picked in Settings > Experiments. Stored in localStorage and
// read through useSyncExternalStore, so every rail button re-renders when the pick changes.

import { useSyncExternalStore } from 'react'

export type RailLookId = 'forged' | 'parchment' | 'rune' | 'arcade' | 'classic'

export const RAIL_LOOKS: Array<{ id: RailLookId; label: string; blurb: string }> = [
  { id: 'forged', label: 'Forged', blurb: 'Painted stone plates in gem-set iron, one gem colour each. The spell book\'s own material.' },
  { id: 'parchment', label: 'Parchment', blurb: 'Painted parchment plaques in carved frames, ink lettering.' },
  { id: 'rune', label: 'Rune', blurb: 'Bronze-edged tablets with a serif face. Fantasy RPG.' },
  { id: 'arcade', label: 'Arcade', blurb: 'Pixel letters, hard edges, a block shadow.' },
  { id: 'classic', label: 'Classic', blurb: 'The cut-corner buttons the Oasis had until now.' },
]

export const DEFAULT_RAIL_LOOK: RailLookId = 'forged'
const KEY = 'oasis-rail-look'

export function isRailLook(value: unknown): value is RailLookId {
  return RAIL_LOOKS.some(l => l.id === value)
}

let current: RailLookId | null = null
const listeners = new Set<() => void>()

function read(): RailLookId {
  if (current) return current
  let saved: string | null = null
  try { saved = window.localStorage.getItem(KEY) } catch { /* private mode */ }
  current = isRailLook(saved) ? saved : DEFAULT_RAIL_LOOK
  return current
}

export function getRailLook(): RailLookId {
  return typeof window === 'undefined' ? DEFAULT_RAIL_LOOK : read()
}

export function setRailLook(look: RailLookId): void {
  current = look
  try { window.localStorage.setItem(KEY, look) } catch { /* ignore */ }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useRailLook(): RailLookId {
  return useSyncExternalStore(subscribe, getRailLook, () => DEFAULT_RAIL_LOOK)
}

/** Which small picture a rail button gets, from its label. */
export type RailIcon = 'menu' | 'world' | 'spells' | 'agents' | 'profile' | 'settings' | 'help' | 'none'

export function railIconFor(label: string): RailIcon {
  const key = label.trim().toLowerCase()
  if (key === 'menu') return 'menu'
  if (key === 'world' || key === 'worlds') return 'world'
  if (key === 'spells') return 'spells'
  if (key === 'agents') return 'agents'
  if (key === 'settings' || key === 'config') return 'settings'
  if (key === 'help') return 'help'
  if (key === 'profile') return 'profile'
  return 'none'
}

/** The painted plate (public/ui/rail/plate-*.png) and plaque (parchment-*.png) each rail button wears. */
export function railPlateFor(icon: RailIcon): { plate: string; plaque: string } {
  switch (icon) {
    case 'menu': return { plate: 'silver', plaque: 'slate' }
    case 'world': return { plate: 'blue', plaque: 'stone' }
    case 'spells': return { plate: 'gold', plaque: 'gold' }
    case 'agents': return { plate: 'green', plaque: 'vine' }
    case 'profile': return { plate: 'violet', plaque: 'wood' }
    case 'settings': return { plate: 'silver', plaque: 'slate' }
    case 'help': return { plate: 'blue', plaque: 'stone' }
    default: return { plate: 'ember', plaque: 'wood' }
  }
}
