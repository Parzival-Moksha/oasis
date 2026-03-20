// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// INPUT STATE MACHINE — One source of truth for "what owns input right now"
// ─═̷─═̷─ॐ─═̷─═̷─ The tree, not the haystack ─═̷─═̷─ॐ─═̷─═̷─
//
// Every keypress, mouseclick, and pointer lock request goes through here.
// The state machine decides what happens. No scattered guards. No fights.
//
// States form an exclusive hierarchy — exactly ONE is active at any time.
// Transitions are explicit. No state can be entered without leaving the previous.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════
// INPUT STATES — the exclusive modes of the input system
// ═══════════════════════════════════════════════════════════════════════════

export type InputState =
  | 'orbit'          // Orbit camera. Mouse = orbit/zoom. Click = select object.
  | 'noclip'         // Fly mode. Pointer locked. WASD = move. Mouse = look.
  | 'third-person'   // Avatar mode. Pointer locked. WASD = move avatar. Mouse = camera orbit.
  | 'agent-focus'    // Camera locked to agent window. Mouse = DOM (2D). Type = textarea.
  | 'placement'      // Placing an object. Click = confirm. Escape = cancel.
  | 'paint'          // Painting ground tiles. Click = paint. Escape = exit.
  | 'ui-focused'     // Typing in a panel/textarea. Keys go to DOM. Only Escape exits.

// ═══════════════════════════════════════════════════════════════════════════
// CAPABILITIES — what each state allows
// ═══════════════════════════════════════════════════════════════════════════

interface StateCapabilities {
  /** WASD/QE movement allowed */
  movement: boolean
  /** Mouse look (pointer lock) active */
  mouseLook: boolean
  /** Clicking objects selects them */
  objectSelection: boolean
  /** R/T/Y transform mode switching */
  transformShortcuts: boolean
  /** Ctrl+C/V copy/paste */
  clipboardShortcuts: boolean
  /** Delete key removes objects */
  deleteShortcut: boolean
  /** Enter key focuses agent windows */
  enterFocuses: boolean
}

const STATE_CAPABILITIES: Record<InputState, StateCapabilities> = {
  'orbit': {
    movement: false,
    mouseLook: false,
    objectSelection: true,
    transformShortcuts: true,
    clipboardShortcuts: true,
    deleteShortcut: true,
    enterFocuses: true,
  },
  'noclip': {
    movement: true,
    mouseLook: true,
    objectSelection: true,  // click selects when not pointer-locked
    transformShortcuts: true,
    clipboardShortcuts: true,
    deleteShortcut: true,
    enterFocuses: true,
  },
  'third-person': {
    movement: true,
    mouseLook: true,
    objectSelection: true,
    transformShortcuts: true,
    clipboardShortcuts: true,
    deleteShortcut: true,
    enterFocuses: true,
  },
  'agent-focus': {
    movement: false,
    mouseLook: false,
    objectSelection: false,
    transformShortcuts: false,
    clipboardShortcuts: false,
    deleteShortcut: false,
    enterFocuses: false,  // already focused
  },
  'placement': {
    movement: true,  // can move while placing in noclip
    mouseLook: true,
    objectSelection: false,  // click = place, not select
    transformShortcuts: false,
    clipboardShortcuts: false,
    deleteShortcut: false,
    enterFocuses: false,
  },
  'paint': {
    movement: true,
    mouseLook: true,
    objectSelection: false,  // click = paint, not select
    transformShortcuts: false,
    clipboardShortcuts: false,
    deleteShortcut: false,
    enterFocuses: false,
  },
  'ui-focused': {
    movement: false,
    mouseLook: false,
    objectSelection: false,
    transformShortcuts: false,
    clipboardShortcuts: false,
    deleteShortcut: false,
    enterFocuses: false,
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSITION TABLE — valid state transitions
// Every transition has a name for debugging and an optional side effect.
// ═══════════════════════════════════════════════════════════════════════════

type TransitionResult = { to: InputState; sideEffect?: () => void } | null

/** Determine the next state when Escape is pressed */
function escapeTransition(current: InputState): TransitionResult {
  switch (current) {
    case 'agent-focus':   return { to: 'orbit' }  // will be overridden to restore previous camera state
    case 'ui-focused':    return { to: 'orbit' }  // will be overridden to restore previous state
    case 'paint':         return { to: 'orbit' }
    case 'placement':     return { to: 'orbit' }
    default:              return null  // orbit/noclip/third-person: deselect (handled by consumer)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ZUSTAND SLICE — the actual state + actions
// This is designed to be merged into oasisStore, but starts standalone
// for clean separation during migration.
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand'

interface InputManagerState {
  /** Current input state */
  inputState: InputState
  /** The camera mode before entering a temporary state (agent-focus, ui-focused) */
  _previousCameraState: InputState | null

  /** Get capabilities for current state */
  can: () => StateCapabilities
  /** Transition to a new state */
  transition: (to: InputState) => void
  /** Handle Escape key — returns true if consumed */
  handleEscape: () => boolean
  /** Enter agent focus mode (saves current state for return) */
  enterAgentFocus: () => void
  /** Enter UI focus mode (saves current state for return) */
  enterUIFocus: () => void
  /** Return to the saved camera state */
  returnToPrevious: () => void
  /** Sync from settings.controlMode (bridge during migration) */
  syncFromControlMode: (mode: 'orbit' | 'noclip' | 'third-person') => void
}

export const useInputManager = create<InputManagerState>((set, get) => ({
  inputState: 'noclip',  // default matches constants.ts
  _previousCameraState: null,

  can: () => STATE_CAPABILITIES[get().inputState],

  transition: (to) => {
    const current = get().inputState
    if (current === to) return

    // Release pointer lock when transitioning to a non-mouseLook state
    if (STATE_CAPABILITIES[current].mouseLook && !STATE_CAPABILITIES[to].mouseLook) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock()
      }
    }

    set({ inputState: to })
  },

  enterAgentFocus: () => {
    const current = get().inputState
    // Save current camera state so Escape can return to it
    const cameraState = (current === 'agent-focus' || current === 'ui-focused')
      ? get()._previousCameraState
      : current
    set({ inputState: 'agent-focus', _previousCameraState: cameraState })

    // Release pointer lock for DOM interaction
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock()
    }
  },

  enterUIFocus: () => {
    const current = get().inputState
    // Don't override previous if we're already in a temporary state
    if (current !== 'ui-focused' && current !== 'agent-focus') {
      set({ inputState: 'ui-focused', _previousCameraState: current })
    } else {
      set({ inputState: 'ui-focused' })
    }
  },

  returnToPrevious: () => {
    const prev = get()._previousCameraState || 'orbit'
    set({ inputState: prev, _previousCameraState: null })
    // Release DOM focus so keyboard events go back to the game (WASD etc.)
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  },

  handleEscape: () => {
    const current = get().inputState
    const result = escapeTransition(current)
    if (!result) return false  // not consumed — let consumer handle (deselect etc.)

    // Return to saved state instead of hardcoded 'orbit'
    const prev = get()._previousCameraState || result.to
    set({ inputState: prev, _previousCameraState: null })
    // Release DOM focus so keyboard events go back to the game
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    result.sideEffect?.()
    return true  // consumed
  },

  syncFromControlMode: (mode) => {
    const current = get().inputState
    // Only sync if we're in a camera state (not in agent-focus, ui-focused, etc.)
    if (current === 'orbit' || current === 'noclip' || current === 'third-person') {
      set({ inputState: mode })
    }
  },
}))

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE — non-hook access for event handlers
// ═══════════════════════════════════════════════════════════════════════════

/** Get current capabilities without React hook (for event handlers) */
export function getInputCapabilities(): StateCapabilities {
  return STATE_CAPABILITIES[useInputManager.getState().inputState]
}

/** Get current input state without React hook */
export function getInputState(): InputState {
  return useInputManager.getState().inputState
}
