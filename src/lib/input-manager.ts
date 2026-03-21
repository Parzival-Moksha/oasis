// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// INPUT STATE MACHINE — One source of truth for "what owns input right now"
// ─═̷─═̷─ॐ─═̷─═̷─ The tree, not the haystack ─═̷─═̷─ॐ─═̷─═̷─
//
// Owns: input state, pointer lock lifecycle, capability queries.
// Everyone reads from here. Nobody checks document.pointerLockElement directly.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { create } from 'zustand'

// ═══════════════════════════════════════════════════════════════════════════
// INPUT STATES
// ═══════════════════════════════════════════════════════════════════════════

export type InputState =
  | 'orbit'          // Orbit camera. Mouse free. Click = select.
  | 'noclip'         // Fly mode. WASD moves. Mouse look when pointer locked.
  | 'third-person'   // Avatar mode. WASD moves avatar. Mouse look when pointer locked.
  | 'agent-focus'    // Camera locked to agent window. Mouse = DOM. Type = textarea.
  | 'placement'      // Placing object. Click = confirm. Escape = cancel.
  | 'paint'          // Painting tiles. Click = paint. Escape = exit.
  | 'ui-focused'     // Typing in panel. Keys → DOM. Escape exits.

// ═══════════════════════════════════════════════════════════════════════════
// CAPABILITIES — what each state allows
// ═══════════════════════════════════════════════════════════════════════════

export interface StateCapabilities {
  movement: boolean
  mouseLook: boolean
  objectSelection: boolean
  transformShortcuts: boolean
  clipboardShortcuts: boolean
  deleteShortcut: boolean
  enterFocuses: boolean
  /** Whether pointer lock CAN be requested in this state */
  canLockPointer: boolean
  /** Whether hover labels should show on objects */
  showHoverLabels: boolean
}

const STATE_CAPABILITIES: Record<InputState, StateCapabilities> = {
  'orbit':        { movement: false, mouseLook: false, objectSelection: true,  transformShortcuts: true,  clipboardShortcuts: true,  deleteShortcut: true,  enterFocuses: true,  canLockPointer: false, showHoverLabels: true  },
  'noclip':       { movement: true,  mouseLook: true,  objectSelection: true,  transformShortcuts: true,  clipboardShortcuts: true,  deleteShortcut: true,  enterFocuses: true,  canLockPointer: true,  showHoverLabels: false },
  'third-person': { movement: true,  mouseLook: true,  objectSelection: true,  transformShortcuts: true,  clipboardShortcuts: true,  deleteShortcut: true,  enterFocuses: true,  canLockPointer: true,  showHoverLabels: false },
  'agent-focus':  { movement: false, mouseLook: false, objectSelection: false, transformShortcuts: false, clipboardShortcuts: false, deleteShortcut: false, enterFocuses: false, canLockPointer: false, showHoverLabels: false },
  'placement':    { movement: true,  mouseLook: true,  objectSelection: false, transformShortcuts: false, clipboardShortcuts: false, deleteShortcut: false, enterFocuses: false, canLockPointer: true,  showHoverLabels: false },
  'paint':        { movement: true,  mouseLook: true,  objectSelection: false, transformShortcuts: false, clipboardShortcuts: false, deleteShortcut: false, enterFocuses: false, canLockPointer: true,  showHoverLabels: false },
  'ui-focused':   { movement: false, mouseLook: false, objectSelection: false, transformShortcuts: false, clipboardShortcuts: false, deleteShortcut: false, enterFocuses: false, canLockPointer: false, showHoverLabels: false },
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCAPE TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════

function escapeTransition(current: InputState): InputState | null {
  switch (current) {
    case 'agent-focus': return 'orbit'  // overridden by _previousCameraState
    case 'ui-focused':  return 'orbit'
    case 'paint':       return 'orbit'
    case 'placement':   return 'orbit'
    default:            return null     // base camera states: not consumed
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

interface InputManagerState {
  inputState: InputState
  pointerLocked: boolean
  _previousCameraState: InputState | null

  // Queries
  can: () => StateCapabilities
  isPointerLocked: () => boolean

  // State transitions
  transition: (to: InputState) => void
  enterAgentFocus: () => void
  enterUIFocus: () => void
  returnToPrevious: () => void
  handleEscape: () => boolean
  syncFromControlMode: (mode: 'orbit' | 'noclip' | 'third-person') => void

  // Pointer lock lifecycle
  requestPointerLock: () => void
  releasePointerLock: () => void
  /** Called by the global pointerlockchange listener — do NOT call manually */
  _syncPointerLockState: () => void

  // Global event setup (call once on mount)
  initGlobalListeners: () => (() => void)
}

export const useInputManager = create<InputManagerState>((set, get) => ({
  inputState: 'noclip',
  pointerLocked: false,
  _previousCameraState: null,

  can: () => STATE_CAPABILITIES[get().inputState],
  isPointerLocked: () => get().pointerLocked,

  // ── STATE TRANSITIONS ──────────────────────────────────────────

  transition: (to) => {
    const current = get().inputState
    if (current === to) return
    // Release pointer lock when transitioning to a state that doesn't use it
    if (get().pointerLocked && !STATE_CAPABILITIES[to].canLockPointer) {
      document.exitPointerLock()
    }
    // Save previous camera state when entering temporary modes (paint/placement)
    // so returnToPrevious() can restore the correct camera mode
    const isTemporary = to === 'paint' || to === 'placement'
    const isBaseCamera = current === 'orbit' || current === 'noclip' || current === 'third-person'
    if (isTemporary && isBaseCamera) {
      set({ inputState: to, _previousCameraState: current })
    } else {
      set({ inputState: to })
    }
  },

  enterAgentFocus: () => {
    const current = get().inputState
    const cameraState = (current === 'agent-focus' || current === 'ui-focused')
      ? get()._previousCameraState : current
    // Release pointer lock for DOM interaction
    if (get().pointerLocked) document.exitPointerLock()
    set({ inputState: 'agent-focus', _previousCameraState: cameraState })
  },

  enterUIFocus: () => {
    const current = get().inputState
    // Release pointer lock so user can interact with UI
    if (get().pointerLocked) document.exitPointerLock()
    if (current !== 'ui-focused' && current !== 'agent-focus') {
      set({ inputState: 'ui-focused', _previousCameraState: current })
    } else {
      set({ inputState: 'ui-focused' })
    }
  },

  returnToPrevious: () => {
    const prev = get()._previousCameraState || 'orbit'
    set({ inputState: prev, _previousCameraState: null })
    // Blur DOM so keyboard goes back to game
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  },

  handleEscape: () => {
    const current = get().inputState
    const fallback = escapeTransition(current)
    if (!fallback) return false
    const prev = get()._previousCameraState || fallback
    set({ inputState: prev, _previousCameraState: null })
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    return true
  },

  syncFromControlMode: (mode) => {
    const current = get().inputState
    if (current === 'orbit' || current === 'noclip' || current === 'third-person') {
      // Release pointer lock when switching to orbit
      if (mode === 'orbit' && get().pointerLocked) {
        document.exitPointerLock()
      }
      set({ inputState: mode })
    }
  },

  // ── POINTER LOCK LIFECYCLE ─────────────────────────────────────

  requestPointerLock: () => {
    if (!STATE_CAPABILITIES[get().inputState].canLockPointer) return
    if (get().pointerLocked) return
    const canvas = document.querySelector('#uploader-canvas') as HTMLCanvasElement
    if (canvas) canvas.requestPointerLock()
  },

  releasePointerLock: () => {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock()
    }
  },

  _syncPointerLockState: () => {
    set({ pointerLocked: !!document.pointerLockElement })
  },

  // ── GLOBAL LISTENERS (call once from Scene.tsx mount) ──────────

  initGlobalListeners: () => {
    const onPointerLockChange = () => {
      get()._syncPointerLockState()
    }

    const onRightClick = (e: MouseEvent) => {
      // Right-click releases pointer lock (noclip/TPS convention)
      if (e.button === 2 && get().pointerLocked) {
        e.preventDefault()
        document.exitPointerLock()
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      // Suppress context menu on canvas
      const target = e.target as HTMLElement
      if (target?.closest('#uploader-canvas') || target?.tagName === 'CANVAS') {
        e.preventDefault()
      }
    }

    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousedown', onRightClick)
    document.addEventListener('contextmenu', onContextMenu)

    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousedown', onRightClick)
      document.removeEventListener('contextmenu', onContextMenu)
    }
  },
}))

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE — non-hook access for event handlers + R3F useFrame
// ═══════════════════════════════════════════════════════════════════════════

export function getInputCapabilities(): StateCapabilities {
  return STATE_CAPABILITIES[useInputManager.getState().inputState]
}

export function getInputState(): InputState {
  return useInputManager.getState().inputState
}

export function isPointerLocked(): boolean {
  return useInputManager.getState().pointerLocked
}
