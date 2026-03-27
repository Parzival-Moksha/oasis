// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// INPUT STATE MACHINE — One source of truth for "what owns input right now"
// ─═̷─═̷─ॐ─═̷─═̷─ The tree, not the haystack ─═̷─═̷─ॐ─═̷─═̷─
//
// Owns: input state, pointer lock lifecycle, capability queries.
// Everyone reads from here. Nobody checks document.pointerLockElement directly.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { create } from 'zustand'
import { useEffect } from 'react'

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
  _uiLayerStack: string[]

  // Queries
  can: () => StateCapabilities
  isPointerLocked: () => boolean
  hasActiveUILayer: () => boolean

  // State transitions
  transition: (to: InputState) => void
  enterAgentFocus: () => void
  enterUIFocus: () => void
  returnToPrevious: () => void
  handleEscape: () => boolean
  syncFromControlMode: (mode: 'orbit' | 'noclip' | 'third-person') => void

  // UI Layer Stack
  pushUILayer: (id: string) => void
  popUILayer: (id: string) => void

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
  _uiLayerStack: [],

  can: () => STATE_CAPABILITIES[get().inputState],
  isPointerLocked: () => get().pointerLocked,
  hasActiveUILayer: () => get()._uiLayerStack.length > 0,

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
    // If UI layers still active, stay in ui-focused
    if (get()._uiLayerStack.length > 0) {
      if (get().inputState !== 'ui-focused') set({ inputState: 'ui-focused' })
      return
    }
    const prev = get()._previousCameraState || 'orbit'
    set({ inputState: prev, _previousCameraState: null })
    // Blur DOM so keyboard goes back to game
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    // Re-acquire pointer lock if returning to a mode that needs it
    if (prev === 'noclip' || prev === 'third-person') {
      setTimeout(() => get().requestPointerLock(), 100)
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
    // Re-acquire pointer lock if returning to a mode that needs it
    if (prev === 'noclip' || prev === 'third-person') {
      setTimeout(() => get().requestPointerLock(), 100)
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

  // ── UI LAYER STACK ────────────────────────────────────────────

  pushUILayer: (id) => {
    const stack = get()._uiLayerStack
    if (stack.includes(id)) return
    set({ _uiLayerStack: [...stack, id] })
    const current = get().inputState
    if (current === 'orbit' || current === 'noclip' || current === 'third-person') {
      get().enterUIFocus()
    }
  },

  popUILayer: (id) => {
    const next = get()._uiLayerStack.filter(x => x !== id)
    set({ _uiLayerStack: next })
    if (next.length === 0 && get().inputState === 'ui-focused') {
      get().returnToPrevious()
    }
  },

  // ── POINTER LOCK LIFECYCLE ─────────────────────────────────────

  requestPointerLock: () => {
    if (get()._uiLayerStack.length > 0) return
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

    // Non-text input types that don't consume keyboard — sliders, color pickers, checkboxes
    const NON_TEXT_INPUT_TYPES = new Set(['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'])

    // Auto-enter ui-focused when any text input gains focus, return on blur
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (!el) return
      const tag = el.tagName
      if (tag === 'INPUT') {
        // Range sliders, color pickers etc. don't need keyboard capture
        if (NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)) return
        if (el.closest('#uploader-canvas')) return
        get().enterUIFocus()
      } else if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
        if (el.closest('#uploader-canvas')) return
        get().enterUIFocus()
      }
    }

    const onFocusOut = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (!el) return
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
        if (get().inputState !== 'ui-focused') return
        // If UI panels are registered, NEVER auto-exit
        if (get()._uiLayerStack.length > 0) return
        // If focus moved to element inside a UI panel, stay
        const related = e.relatedTarget as HTMLElement | null
        if (related?.closest('[data-ui-panel]')) return
        get().returnToPrevious()
      }
    }

    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousedown', onRightClick)
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousedown', onRightClick)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  },
}))

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE — non-hook access for event handlers + R3F useFrame
// ═══════════════════════════════════════════════════════════════════════════

export function getInputCapabilities(): StateCapabilities {
  return STATE_CAPABILITIES[useInputManager.getState().inputState]
}

export function hasActiveUILayer(): boolean {
  return useInputManager.getState()._uiLayerStack.length > 0
}

// ═══════════════════════════════════════════════════════════════════════════
// useUILayer — register a panel as an active UI layer
// ═══════════════════════════════════════════════════════════════════════════

export function useUILayer(id: string, active: boolean = true) {
  useEffect(() => {
    if (!active) return
    useInputManager.getState().pushUILayer(id)
    return () => useInputManager.getState().popUILayer(id)
  }, [id, active])
}

export function getInputState(): InputState {
  return useInputManager.getState().inputState
}

export function isPointerLocked(): boolean {
  return useInputManager.getState().pointerLocked
}
