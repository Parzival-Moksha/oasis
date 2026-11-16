// The main menu's state: open or not, and the owner's picks for how it feels.
// The menu holds the input manager's UI layer while it is open, so the character does not walk
// and world keys do not fire under it.

import { create } from 'zustand'
import { useInputManager } from '@/lib/input-manager'
import { DEFAULT_FEEL, FEEL_STYLES, type FeelId } from './menu-feel'
import type { MenuPhase } from './menu-escape'

export type MenuSoundId = 'glass' | 'arcade' | 'thud' | 'classic' | 'off'

export const MENU_SOUNDS: Array<{ id: MenuSoundId; label: string; blurb: string }> = [
  { id: 'glass', label: 'Glass', blurb: 'A soft bell tick, a two-note chime on click.' },
  { id: 'arcade', label: 'Arcade', blurb: 'Square-wave blips, a rising pair on click.' },
  { id: 'thud', label: 'Thud', blurb: 'A felt tap, a low wooden knock on click.' },
  { id: 'classic', label: 'Classic', blurb: 'The sounds the rail buttons use today.' },
  { id: 'off', label: 'Off', blurb: 'Silent.' },
]

export interface MenuPrefs {
  feel: FeelId
  sound: MenuSoundId
  /** Tiles lean towards the mouse and the title and grid shift a little against it. */
  tilt: boolean
  /** The camera drifts behind the menu. Off: it stays where it was. */
  drift: boolean
  /** Escape out of mouse-look opens the menu at once (one press instead of two). */
  openFromMouseLook: boolean
}

export const DEFAULT_MENU_PREFS: MenuPrefs = {
  feel: DEFAULT_FEEL,
  sound: 'glass',
  tilt: true,
  drift: true,
  openFromMouseLook: true,
}

const PREFS_KEY = 'oasis-game-menu-prefs'
const LAYER_ID = 'game-menu'

export function sanitizeMenuPrefs(raw: unknown): MenuPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    feel: FEEL_STYLES.some(s => s.id === r.feel) ? (r.feel as FeelId) : DEFAULT_MENU_PREFS.feel,
    sound: MENU_SOUNDS.some(s => s.id === r.sound) ? (r.sound as MenuSoundId) : DEFAULT_MENU_PREFS.sound,
    tilt: bool(r.tilt, DEFAULT_MENU_PREFS.tilt),
    drift: bool(r.drift, DEFAULT_MENU_PREFS.drift),
    openFromMouseLook: bool(r.openFromMouseLook, DEFAULT_MENU_PREFS.openFromMouseLook),
  }
}

function loadPrefs(): MenuPrefs {
  if (typeof window === 'undefined') return DEFAULT_MENU_PREFS
  try { return sanitizeMenuPrefs(JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}')) } catch { return DEFAULT_MENU_PREFS }
}

interface GameMenuState {
  phase: MenuPhase
  /** Counts opens, so the camera can tell one opening from the next. */
  openCount: number
  /** The pointer was locked (mouse-look) when the menu opened: Continue hands it back. */
  openedFromMouseLook: boolean
  prefs: MenuPrefs
  openMenu: (options?: { fromMouseLook?: boolean }) => void
  /** Start closing: the tiles fade and the camera comes back. */
  closeMenu: (options?: { relock?: boolean }) => void
  /** The camera is back (or there was nothing to bring back): the menu is fully closed. */
  finishClose: () => void
  setPrefs: (patch: Partial<MenuPrefs>) => void
}

let closeFallback: ReturnType<typeof setTimeout> | null = null
/** Continue from mouse-look: ask for the pointer lock once the layer is gone. */
let relockWhenClosed = false

// Push and pop are idempotent in the input manager, so no flag of our own to go stale.
function holdLayer() {
  useInputManager.getState().pushUILayer(LAYER_ID)
}

function dropLayer() {
  if (useInputManager.getState()._uiLayerStack.includes(LAYER_ID)) useInputManager.getState().popUILayer(LAYER_ID)
}

export const useGameMenu = create<GameMenuState>((set, get) => ({
  phase: 'closed',
  openCount: 0,
  openedFromMouseLook: false,
  prefs: loadPrefs(),

  openMenu: (options) => {
    // Not while the camera is still on its way back: its resting place is not known again yet.
    if (get().phase !== 'closed') return
    const fromMouseLook = options?.fromMouseLook ?? useInputManager.getState().pointerLocked
    holdLayer()
    set(s => ({ phase: 'open', openCount: s.openCount + 1, openedFromMouseLook: fromMouseLook }))
  },

  closeMenu: (options) => {
    if (get().phase !== 'open') return
    relockWhenClosed = Boolean(options?.relock)
    set({ phase: 'returning' })
    // In third person the character gets its controls back at once and the camera glides home
    // around it. In the free cameras the camera itself is the state, so input waits for it.
    if (useInputManager.getState()._previousCameraState === 'third-person') dropLayer()
    // If the camera component is not there to finish the close, do it anyway.
    if (closeFallback) clearTimeout(closeFallback)
    closeFallback = setTimeout(() => get().finishClose(), 1500)
  },

  finishClose: () => {
    if (closeFallback) { clearTimeout(closeFallback); closeFallback = null }
    dropLayer()
    if (get().phase === 'returning') set({ phase: 'closed' })
    if (relockWhenClosed) {
      relockWhenClosed = false
      useInputManager.getState().requestPointerLock()
    }
  },

  setPrefs: (patch) => {
    const prefs = sanitizeMenuPrefs({ ...get().prefs, ...patch })
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
    set({ prefs })
  },
}))
