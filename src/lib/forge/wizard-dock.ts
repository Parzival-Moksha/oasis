// The Wizard console as a panel docked to the right edge, like the agent panel in E mode (owner, 2026-11-19 at 2:31:
// "stuck to the right edge of the screen... I could horizontally resize it and... where the center of the map is would
// adjust"). Its width is remembered (this browser). While it is open, the 3D view's centre moves into what is left
// (WizardDockViewOffset shifts the camera's projection by half the panel).

import { useSyncExternalStore } from 'react'

export const WIZARD_DOCK_MIN_WIDTH = 360
export const WIZARD_DOCK_MARGIN = 12
const DEFAULT_FRACTION = 1 / 3
const KEY = 'oasis-wizard-dock-width'

export interface WizardDockGeometry {
  /** 'right': docked beside the world; 'sheet': a phone-sized screen, the panel takes the width and nothing shifts. */
  side: 'right' | 'sheet'
  width: number
  /** Pixels the world gives up on the right (panel + margins); 0 for a sheet. */
  inset: number
}

/** The widest the panel may get: the world keeps at least 300 px beside it. */
export function wizardDockMaxWidth(viewportWidth: number): number {
  return Math.max(WIZARD_DOCK_MIN_WIDTH, Math.min(1400, viewportWidth - 300 - WIZARD_DOCK_MARGIN * 2))
}

export function wizardDockGeometry(viewportWidth: number, preferredWidth: number | null): WizardDockGeometry {
  if (viewportWidth < 700) return { side: 'sheet', width: Math.max(0, viewportWidth - WIZARD_DOCK_MARGIN * 2), inset: 0 }
  const wanted = preferredWidth ?? Math.round(viewportWidth * DEFAULT_FRACTION)
  const width = Math.round(Math.min(wizardDockMaxWidth(viewportWidth), Math.max(WIZARD_DOCK_MIN_WIDTH, wanted)))
  return { side: 'right', width, inset: width + WIZARD_DOCK_MARGIN * 2 }
}

// ─── the remembered width and whether the console is open ─────────────────

let width: number | null | undefined
let open = false
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach(fn => fn()) }

export function getWizardDockWidth(): number | null {
  if (width === undefined) {
    let stored: number | null = null
    try {
      const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY)
      stored = raw && Number.isFinite(Number(raw)) ? Number(raw) : null
    } catch { /* storage off */ }
    width = stored
  }
  return width
}

export function setWizardDockWidth(next: number | null): void {
  const value = next === null ? null : Math.round(Math.max(WIZARD_DOCK_MIN_WIDTH, next))
  if (value === getWizardDockWidth()) return
  width = value
  try {
    if (value === null) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, String(value))
  } catch { /* storage off */ }
  emit()
}

export function isWizardDockOpen(): boolean { return open }

export function setWizardDockOpen(next: boolean): void {
  if (open === next) return
  open = next
  emit()
}

export function subscribeWizardDock(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Re-renders when the width or the open state changes. */
export function useWizardDockVersion(): number {
  return useSyncExternalStore(subscribeWizardDock, () => version, () => 0)
}

/** Pixels on the right the 3D view should leave free right now (0 when the console is closed). */
export function wizardDockInset(viewportWidth: number): number {
  return open ? wizardDockGeometry(viewportWidth, getWizardDockWidth()).inset : 0
}
