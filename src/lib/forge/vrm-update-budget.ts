// ░▒▓ VRM UPDATE BUDGET — a body nobody can see does not need 165 poses a second ▓▒░
// Every VRM body runs its animation mixer, spring bones (hair, cloth), expressions and eye
// target each frame. For a body outside the camera's view that work draws nothing. Such a body
// drops to "background": the mixer alone, a few times a second, so its pose is current when
// the camera turns back. Anything the owner can see keeps the full rate, so nothing on screen
// changes.

import { Frustum, Matrix4, Sphere, Vector3, type Camera } from 'three'

/** Mixer steps a second for a body out of view. */
export const VRM_BACKGROUND_HZ = 10
/** Closer than this the body always gets the full rate, in view or not (it may be just behind the camera's shoulder). */
export const VRM_ALWAYS_FULL_M = 4
/** Extra radius around the body for the view test, so it is back at full rate before it shows. */
export const VRM_VIEW_MARGIN_M = 2
/** A body that moved further than this while in the background gets its spring bones reset (no whip when it comes back). */
export const VRM_SPRING_RESET_M = 0.05

export type VrmUpdateMode = 'full' | 'background'

export interface VrmBudgetInput {
  /** The body's bounding sphere (with margin) touches the camera frustum. */
  inView: boolean
  /** Meters from the camera. */
  distance: number
  /** Lip sync is driving the mouth. */
  speaking: boolean
  /** A play-once clip is running (a flinch, a fall): it must end at full rate. */
  onceClip: boolean
}

export function vrmUpdateMode(input: VrmBudgetInput): VrmUpdateMode {
  if (input.inView || input.speaking || input.onceClip) return 'full'
  if (!(input.distance > VRM_ALWAYS_FULL_M)) return 'full' // also NaN: when in doubt, full
  return 'background'
}

/** Collects frame deltas and hands them out in steps of 1 / hz seconds. */
export class BackgroundStepper {
  private pending = 0
  constructor(private hz = VRM_BACKGROUND_HZ) {}

  /** Adds this frame's delta; returns the time to advance by now, or 0 to skip this frame. */
  add(delta: number): number {
    this.pending += delta
    if (this.pending < 1 / this.hz) return 0
    const step = this.pending
    this.pending = 0
    return step
  }

  /** Time collected but not handed out yet (to flush when the body returns to full rate). */
  take(): number {
    const step = this.pending
    this.pending = 0
    return step
  }
}

// ── The camera's view, computed once a frame and shared by every body ───────────────────────────

const frustum = new Frustum()
const projection = new Matrix4()
const sphere = new Sphere()
const cameraPosition = new Vector3()
let viewStamp: number | null = null
let viewCamera: Camera | null = null

/** Refreshes the shared view for this frame (`stamp`: the frame's clock time). Cheap to call from every body. */
export function refreshVrmView(camera: Camera, stamp: number): void {
  if (stamp === viewStamp && camera === viewCamera) return
  viewStamp = stamp
  viewCamera = camera
  projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frustum.setFromProjectionMatrix(projection)
  cameraPosition.setFromMatrixPosition(camera.matrixWorld)
}

/** Whether a body centred at `center` with `radius` (margin added here) is in the shared view, and how far it is. */
export function vrmViewOf(center: Vector3, radius: number): { inView: boolean; distance: number } {
  sphere.center.copy(center)
  sphere.radius = radius + VRM_VIEW_MARGIN_M
  return { inView: frustum.intersectsSphere(sphere), distance: cameraPosition.distanceTo(center) }
}

// ── On/off, for before/after measurements and as an escape hatch ────────────────────────────────

let budgetEnabled = true
const stats = { full: 0, background: 0 }

export function isVrmBudgetEnabled(): boolean {
  return budgetEnabled
}

/** Bodies count themselves each frame (dev readout). */
export function noteVrmMode(mode: VrmUpdateMode, stamp: number): void {
  if (stamp !== statsStamp) {
    lastStats = { full: stats.full, background: stats.background }
    stats.full = 0
    stats.background = 0
    statsStamp = stamp
  }
  stats[mode] += 1
}
let statsStamp: number | null = null
let lastStats = { full: 0, background: 0 }

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisVrmBudget = {
    enabled: () => budgetEnabled,
    setEnabled: (enabled: boolean) => { budgetEnabled = enabled },
    /** Bodies at full rate / in the background in the last whole frame. */
    stats: () => ({ ...lastStats }),
  }
}
