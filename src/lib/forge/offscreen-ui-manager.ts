// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OFFSCREEN UI MANAGER — Hybrid Render: texture for unfocused, DOM overlay for focused
// ─═̷─═̷─ॐ─═̷─═̷─ html2canvas captures unfocused windows to texture ─═̷─═̷─ॐ─═̷─═̷─
// Focused window: container made visible + CSS 3D positioned (no capture needed)
// Unfocused windows: captured at 2-7fps → CanvasTexture on 3D mesh
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'

interface OffscreenWindow {
  container: HTMLDivElement
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  dirty: boolean
  lastCapture: number
  observer: MutationObserver
  scrollHandler: () => void
  agentType: string
  streaming: boolean
  streamingTimeout: ReturnType<typeof setTimeout> | null
  capturing: boolean
  paused: boolean          // true when window is focused (visible overlay, no capture needed)
  width: number
  height: number
  captureMode: 'snapdom' | 'foreign-object'
}

// snapdom: 148x faster than html2canvas. SVG foreignObject + aggressive caching.
// ~3-8ms per capture vs 20-50ms for html2canvas.
// Capture on focus-loss + periodic low-fps updates for streaming content.
const IDLE_CAPTURE_INTERVAL = 2000   // 0.5fps when idle (nearly free with snapdom)
const STREAMING_CAPTURE_INTERVAL = 300 // ~3fps when streaming

let _snapdom: ((el: HTMLElement, opts?: Record<string, unknown>) => Promise<{ toCanvas: () => Promise<HTMLCanvasElement> }>) | null = null
async function getSnapdom() {
  if (_snapdom) return _snapdom
  try {
    const mod = await import('@zumer/snapdom')
    _snapdom = (mod as any).snapdom || (mod as any).default?.snapdom || (mod as any).default
    return _snapdom
  } catch {
    // Fallback: html-to-image style foreignObject approach
    return null
  }
}

class OffscreenUIManager {
  private windows = new Map<string, OffscreenWindow>()
  private rafId: number | null = null

  mount(windowId: string, width: number, height: number, agentType?: string, captureMode: 'snapdom' | 'foreign-object' = 'snapdom'): { container: HTMLDivElement, texture: THREE.CanvasTexture } {
    if (this.windows.has(windowId)) {
      const existing = this.windows.get(windowId)!
      return { container: existing.container, texture: existing.texture }
    }

    const container = document.createElement('div')
    container.style.cssText = `
      position: fixed;
      left: 0px;
      top: 0px;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #0a0a0f;
      color: #e5e5e5;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 14px;
      opacity: 0;
      pointer-events: none;
      z-index: -1;
      transform-origin: top left;
    `
    container.dataset.offscreenWindow = windowId
    document.body.appendChild(container)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, width, height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true

    const observer = new MutationObserver((mutations) => {
      const win = this.windows.get(windowId)
      if (!win) return
      win.dirty = true
      const hasCharData = mutations.some(m => m.type === 'characterData')
      if (hasCharData) {
        win.streaming = true
        if (win.streamingTimeout) clearTimeout(win.streamingTimeout)
        win.streamingTimeout = setTimeout(() => {
          win.streaming = false
          win.streamingTimeout = null
        }, 3000)
      }
    })
    observer.observe(container, {
      subtree: true, childList: true,
      characterData: true, attributes: true,
      attributeFilter: ['class', 'data-streaming', 'style'],
    })

    const scrollHandler = () => {
      const w = this.windows.get(windowId)
      if (w) w.dirty = true
    }
    container.addEventListener('scroll', scrollHandler, { capture: true, passive: true })

    const win: OffscreenWindow = {
      container, texture, canvas, ctx,
      dirty: true, lastCapture: 0,
      observer, scrollHandler,
      agentType: agentType || 'agent',
      streaming: false, streamingTimeout: null,
      capturing: false, paused: false,
      width, height,
      captureMode,
    }
    this.windows.set(windowId, win)
    if (this.rafId === null) this.startLoop()

    return { container, texture }
  }

  unmount(windowId: string) {
    const win = this.windows.get(windowId)
    if (!win) return
    win.observer.disconnect()
    if (win.streamingTimeout) clearTimeout(win.streamingTimeout)
    win.container.removeEventListener('scroll', win.scrollHandler, { capture: true })
    win.texture.dispose()
    win.container.remove()
    this.windows.delete(windowId)
    if (this.windows.size === 0) this.stopLoop()
  }

  markDirty(windowId: string) {
    const win = this.windows.get(windowId)
    if (win) win.dirty = true
  }

  resize(windowId: string, width: number, height: number) {
    const win = this.windows.get(windowId)
    if (!win) return
    win.container.style.width = `${width}px`
    win.container.style.height = `${height}px`
    win.canvas.width = width
    win.canvas.height = height
    win.width = width
    win.height = height
    win.dirty = true
  }

  getTexture(windowId: string): THREE.CanvasTexture | null {
    return this.windows.get(windowId)?.texture ?? null
  }

  getContainer(windowId: string): HTMLDivElement | null {
    return this.windows.get(windowId)?.container ?? null
  }

  isStreaming(windowId: string): boolean {
    return this.windows.get(windowId)?.streaming ?? false
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FOCUS MODE — pause capture, make container visible for direct interaction
  // ═══════════════════════════════════════════════════════════════════════

  /** Pause capture + make container available for visible overlay */
  setFocused(windowId: string, focused: boolean) {
    const win = this.windows.get(windowId)
    if (!win) return
    win.paused = focused
    if (focused) {
      // Make interactive — container will be positioned by CSS 3D transform
      win.container.style.opacity = '1'
      win.container.style.pointerEvents = 'auto'
      win.container.style.zIndex = '10000'
    } else {
      // Back to hidden — capture one final snapshot, then hide
      win.container.style.pointerEvents = 'none'
      win.container.style.zIndex = '-1'
      win.container.style.transform = ''
      // Capture snapshot BEFORE hiding (html2canvas needs visible DOM)
      this.captureWindow(win).then(() => {
        win.container.style.opacity = '0'
      })
    }
  }

  /** Update CSS transform for focused window (called from rAF) */
  setCSSTransform(windowId: string, cssTransform: string) {
    const win = this.windows.get(windowId)
    if (!win || !win.paused) return
    win.container.style.transform = cssTransform
  }

  /** One-shot capture — grab current state before transitioning */
  async captureImmediate(windowId: string) {
    const win = this.windows.get(windowId)
    if (!win) return
    await this.captureWindow(win)
  }

  getWindowSize(windowId: string): { width: number; height: number } | null {
    const win = this.windows.get(windowId)
    if (!win) return null
    return { width: win.width, height: win.height }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // html2canvas capture
  // ═══════════════════════════════════════════════════════════════════════

  private async captureWindow(win: OffscreenWindow) {
    if (win.capturing) return
    win.capturing = true

    try {
      // Briefly make visible (snapdom needs computed styles)
      const wasPaused = win.paused
      if (!wasPaused) {
        win.container.style.opacity = '1'
        win.container.style.zIndex = '-1'
      }

      const snapdom = win.captureMode === 'snapdom' ? await getSnapdom() : null
      let screenshot: HTMLCanvasElement | null = null

      if (snapdom) {
        const result = await snapdom(win.container, { cache: 'full' } as any)
        screenshot = await result.toCanvas()
      } else {
        // Fallback: basic foreignObject approach (no external deps)
        const svgNS = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(svgNS, 'svg')
        svg.setAttribute('width', String(win.width))
        svg.setAttribute('height', String(win.height))
        const fo = document.createElementNS(svgNS, 'foreignObject')
        fo.setAttribute('width', '100%')
        fo.setAttribute('height', '100%')
        const clone = win.container.cloneNode(true) as HTMLElement
        clone.style.opacity = '1'
        clone.style.position = 'static'
        fo.appendChild(clone)
        svg.appendChild(fo)
        const svgStr = new XMLSerializer().serializeToString(svg)
        const img = new Image()
        img.width = win.width
        img.height = win.height
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = reject
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr)
        })
        screenshot = document.createElement('canvas')
        screenshot.width = win.width
        screenshot.height = win.height
        screenshot.getContext('2d')!.drawImage(img, 0, 0)
      }

      if (!wasPaused) {
        win.container.style.opacity = '0'
      }

      if (screenshot) {
        win.ctx.clearRect(0, 0, win.canvas.width, win.canvas.height)
        win.ctx.drawImage(screenshot, 0, 0, win.canvas.width, win.canvas.height)
        win.texture.needsUpdate = true
      }
    } catch (err) {
      win.ctx.fillStyle = '#0a0a0f'
      win.ctx.fillRect(0, 0, win.canvas.width, win.canvas.height)
      win.ctx.fillStyle = '#38bdf8'
      win.ctx.font = '14px Inter, system-ui, sans-serif'
      win.ctx.fillText('Rendering...', 20, win.canvas.height / 2)
      win.texture.needsUpdate = true
    } finally {
      win.capturing = false
    }
  }

  private startLoop() {
    const loop = () => {
      this.rafId = requestAnimationFrame(loop)
      const now = performance.now()
      for (const [, win] of this.windows) {
        if (win.paused || !win.dirty || win.capturing) continue
        const interval = win.streaming ? STREAMING_CAPTURE_INTERVAL : IDLE_CAPTURE_INTERVAL
        if (now - win.lastCapture < interval) continue
        win.dirty = false
        win.lastCapture = now
        this.captureWindow(win) // snapdom is async + fast (~3-8ms), won't block
      }
    }
    this.rafId = requestAnimationFrame(loop)
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  dispose() {
    this.stopLoop()
    const ids = [...this.windows.keys()]
    for (const id of ids) this.unmount(id)
  }
}

// Singleton on globalThis — survives HMR
const CACHE_KEY = '__oasisOffscreenUI' as const

function getOffscreenUIManager(): OffscreenUIManager | null {
  if (typeof document === 'undefined') return null
  if (!(globalThis as Record<string, unknown>)[CACHE_KEY]) {
    (globalThis as Record<string, unknown>)[CACHE_KEY] = new OffscreenUIManager()
  }
  return (globalThis as Record<string, unknown>)[CACHE_KEY] as OffscreenUIManager
}

export { getOffscreenUIManager, OffscreenUIManager }
