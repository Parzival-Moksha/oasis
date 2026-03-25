// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEST HARNESS — Parzival's Hands
// Exposes Oasis internals on window.__oasis for Playwright to query + drive
// Only active in dev mode. Zero production overhead.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useOasisStore } from '../store/oasisStore'
import { useInputManager } from './input-manager'
import { dispatch } from './event-bus'
import type { AgentWindowType } from '../store/oasisStore'

declare global {
  interface Window {
    __oasis: OasisTestHarness
  }
}

export interface OasisTestHarness {
  // ── STATE QUERIES ──────────────────────────────────────────
  getInputState: () => string
  getControlMode: () => string
  getFocusedWindowId: () => string | null
  getSelectedObjectId: () => string | null
  getPlacedAgentWindows: () => Array<{ id: string; agentType: string; position: [number, number, number] }>
  isPointerLocked: () => boolean
  isWorldReady: () => boolean
  getCameraPosition: () => [number, number, number]
  getCameraTarget: () => [number, number, number]

  // ── ACTIONS ────────────────────────────────────────────────
  placeAgentWindow: (agentType: AgentWindowType, position?: [number, number, number]) => string
  selectObject: (id: string | null) => void
  focusWindow: (id: string) => void
  unfocusWindow: () => void
  setControlMode: (mode: 'orbit' | 'noclip' | 'third-person') => void
  deleteObject: (id: string) => void
  updateAgentWindow: (id: string, updates: Record<string, unknown>) => void

  // ── READINESS ──────────────────────────────────────────────
  ready: boolean
}

export function installTestHarness() {
  if (typeof window === 'undefined') return

  const harness: OasisTestHarness = {
    ready: true,

    // ── QUERIES ────────────────────────────────────
    getInputState: () => useInputManager.getState().inputState,

    getControlMode: () => {
      // Read from localStorage since settings are stored there
      try {
        const settings = JSON.parse(localStorage.getItem('oasis-settings') || '{}')
        return settings.controlMode || 'noclip'
      } catch { return 'unknown' }
    },

    getFocusedWindowId: () => useOasisStore.getState().focusedAgentWindowId,

    getSelectedObjectId: () => useOasisStore.getState().selectedObjectId,

    getPlacedAgentWindows: () =>
      useOasisStore.getState().placedAgentWindows.map(w => ({
        id: w.id,
        agentType: w.agentType,
        position: w.position,
      })),

    isPointerLocked: () => useInputManager.getState().pointerLocked,

    isWorldReady: () => (useOasisStore.getState() as any)._worldReady ?? false,

    getCameraPosition: () => {
      // R3F stores its fiber root on the canvas DOM element
      const canvas = document.getElementById('uploader-canvas')
      if (!canvas) return [0, 0, 0]
      const store = (canvas as any).__r3f?.store
      if (store) {
        const cam = store.getState().camera
        return [cam.position.x, cam.position.y, cam.position.z]
      }
      // Fallback: try globalThis (set by CameraController)
      const cam = (globalThis as any).__oasisCamera
      if (cam) return [cam.position.x, cam.position.y, cam.position.z]
      return [0, 0, 0]
    },

    getCameraTarget: () => {
      const canvas = document.getElementById('uploader-canvas')
      if (!canvas) return [0, 0, 0]
      const store = (canvas as any).__r3f?.store
      if (store) {
        const cam = store.getState().camera
        const dir = { x: 0, y: 0, z: 0 }
        cam.getWorldDirection(dir)
        return [cam.position.x + dir.x, cam.position.y + dir.y, cam.position.z + dir.z]
      }
      return [0, 0, 0]
    },

    // ── ACTIONS ────────────────────────────────────
    placeAgentWindow: (agentType, position = [0, 3, 5]) => {
      const id = `agent-${agentType}-${Date.now()}`
      useOasisStore.getState().addAgentWindow({
        id,
        agentType,
        position,
        rotation: [0, 0, 0],
        scale: 1,
        width: 800,
        height: 600,
      })
      return id
    },

    selectObject: (id) => {
      dispatch({ type: 'SELECT_OBJECT', payload: { id } })
      if (id) dispatch({ type: 'INSPECT_OBJECT', payload: { id } })
    },

    focusWindow: (id) => {
      dispatch({ type: 'FOCUS_AGENT_WINDOW', payload: { id } })
    },

    unfocusWindow: () => {
      dispatch({ type: 'UNFOCUS_AGENT_WINDOW' })
    },

    setControlMode: (mode) => {
      dispatch({ type: 'SET_CAMERA_MODE', payload: { mode } })
    },

    deleteObject: (id) => {
      dispatch({ type: 'DELETE_OBJECT', payload: { id } })
    },

    updateAgentWindow: (id: string, updates: Record<string, unknown>) => {
      useOasisStore.getState().updateAgentWindow(id, updates)
    },
  }

  window.__oasis = harness
  console.log('[TestHarness] ✅ window.__oasis installed — Parzival has hands')
}
