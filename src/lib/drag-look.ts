// ░▒▓ DRAG LOOK — the camera without pointer lock ▓▒░
// Some browsers never give the page the mouse: the owner played the Oasis in Claude Code's built-in browser and the
// camera never followed the mouse (2026-11-18), the pane refuses pointer lock. When a lock request fails (an
// error, a refusal, or no answer within LOCK_ANSWER_MS) the camera switches to drag-to-look for this page:
// - the right mouse button dragged anywhere on the world turns the camera at once;
// - the left button too, once it moved DRAG_START_PX (a plain click still selects, places and casts), and the
//   click that ends such a drag is swallowed, so a look never clicks something by accident.
// The movement goes through the same queue as touch look (pushMouseLookDelta). Said once, as a notice.
// It also checks, once, whether WebGL runs on the GPU: a software renderer (SwiftShader, WARP, llvmpipe) is why an
// embedded pane can be "super laggy", and the notice says so.

export const LOCK_ANSWER_MS = 1600
export const DRAG_START_PX = 4

type PushDelta = (x: number, y: number, timeStamp?: number) => void
type Notify = (text: string, tone?: 'info' | 'warn' | 'error') => void

interface DragLookState {
  on: boolean
  /** This page held pointer lock at least once: the browser can, so a refusal is a cooldown, not "can't". */
  everLocked: boolean
  failures: number
  reason: string | null
  announced: boolean
  softwareChecked: boolean
}

const g = globalThis as unknown as { __oasisDragLook?: DragLookState }
const state: DragLookState = g.__oasisDragLook ??= { on: false, everLocked: false, failures: 0, reason: null, announced: false, softwareChecked: false }
let notify: Notify | null = null
const listeners = new Set<() => void>()

export function isDragLookOn(): boolean {
  return state.on
}

export function subscribeDragLook(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setDragLookNotifier(fn: Notify | null): void {
  notify = fn
  if (fn && state.on && !state.announced) announce()
}

/** Which renderer WebGL got: software ones (no GPU) make the Oasis crawl. */
export function softwareRendererName(renderer: string | null | undefined): string | null {
  const r = String(renderer || '')
  if (/swiftshader/i.test(r)) return 'SwiftShader'
  if (/microsoft basic render|\bwarp\b/i.test(r)) return 'Microsoft Basic Render (WARP)'
  if (/llvmpipe|softpipe|software/i.test(r)) return 'a software renderer'
  return null
}

function readRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return 'no WebGL'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return null
  }
}

function announce(): void {
  if (!notify) return
  state.announced = true
  let text = 'This browser does not give the Oasis the mouse (no pointer lock), so the camera turns by dragging: hold the right (or left) mouse button and move.'
  if (!state.softwareChecked) {
    state.softwareChecked = true
    const soft = softwareRendererName(readRenderer())
    if (soft) text += ` It also draws without the GPU (${soft}), which is why it lags: open the Oasis in Chrome or Brave for full speed.`
  }
  notify(text, 'info')
}

/** FAILS_TO_SWITCH failures in a row, and never a lock: this browser can't, the camera turns by dragging. */
export const FAILS_TO_SWITCH = 2

/**
 * A pointer-lock request failed, was refused, or got no answer. Chrome and Brave also refuse for a moment after
 * Esc left a lock: that page held a lock before, so it never counts. Returns whether drag look is on now.
 */
export function noteLockFailed(reason: string): boolean {
  if (state.on || state.everLocked) return state.on
  state.failures += 1
  if (state.failures < FAILS_TO_SWITCH) return false
  state.on = true
  state.reason = reason
  listeners.forEach(listener => listener())
  announce()
  return true
}

/** The page got the lock: the browser can do it after all (drag look goes off again). */
export function noteLockGranted(): void {
  state.everLocked = true
  state.failures = 0
  if (!state.on) return
  state.on = false
  listeners.forEach(listener => listener())
}

/** For tests and a page that later gets the lock after all: back to pointer lock. */
export function resetDragLook(): void {
  state.on = false
  state.everLocked = false
  state.failures = 0
  state.reason = null
  state.announced = false
  listeners.forEach(listener => listener())
}

/**
 * The drag gesture itself. Pure enough to test: feed it pointer events, it says how much to turn and whether the
 * click that follows must be swallowed.
 */
export function createDragTracker() {
  let active: { button: number; x: number; y: number; looking: boolean; pointerId: number } | null = null
  let swallowClick = false
  return {
    down(event: { button: number; clientX: number; clientY: number; pointerId: number }): void {
      if (event.button !== 0 && event.button !== 2) return
      active = { button: event.button, x: event.clientX, y: event.clientY, looking: event.button === 2, pointerId: event.pointerId }
      swallowClick = false
    },
    /** Returns the turn to apply (0, 0 while a left press has not moved far enough yet). */
    move(event: { clientX: number; clientY: number; movementX: number; movementY: number; pointerId: number }): { x: number; y: number } {
      if (!active || event.pointerId !== active.pointerId) return { x: 0, y: 0 }
      if (!active.looking) {
        if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < DRAG_START_PX) return { x: 0, y: 0 }
        active.looking = true
        // The distance it took to start counts as turning too: no jump at the start.
        return { x: event.clientX - active.x, y: event.clientY - active.y }
      }
      return { x: event.movementX, y: event.movementY }
    },
    up(event: { pointerId: number }): void {
      if (!active || event.pointerId !== active.pointerId) return
      swallowClick = active.looking && active.button === 0
      active = null
    },
    /** The click after a left drag that looked: swallow it once. */
    takeSwallowClick(): boolean {
      const s = swallowClick
      swallowClick = false
      return s
    },
    get dragging(): boolean { return Boolean(active?.looking) },
  }
}

/** Listens on the world canvas while drag look is on. Installed once by input-manager. */
export function installDragLook(push: PushDelta, canDrag: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {}
  const tracker = createDragTracker()
  const onCanvas = (event: Event) => {
    const wrapper = document.querySelector('#uploader-canvas')
    return Boolean(wrapper && event.target instanceof Node && wrapper.contains(event.target))
  }
  const onDown = (event: PointerEvent) => {
    if (!state.on || event.pointerType === 'touch' || !onCanvas(event) || !canDrag()) return
    tracker.down(event)
  }
  const onMove = (event: PointerEvent) => {
    if (!state.on) return
    const turn = tracker.move(event)
    if (turn.x || turn.y) push(turn.x, turn.y, event.timeStamp)
  }
  const onUp = (event: PointerEvent) => { tracker.up(event) }
  const onClick = (event: MouseEvent) => {
    if (!state.on || !tracker.takeSwallowClick()) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onContextMenu = (event: MouseEvent) => {
    // Right-drag is the look button here: no context menu over the world.
    if (state.on && onCanvas(event)) event.preventDefault()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
  }
}
