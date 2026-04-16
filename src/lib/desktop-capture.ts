export type DesktopCaptureSourceKind =
  | 'window'
  | 'screen'
  | 'browser-tab'
  | 'browser-view'
  | 'web-contents'

export interface DesktopCaptureSource {
  id: string
  name: string
  kind: DesktopCaptureSourceKind
  appName?: string
  thumbnailUrl?: string
  width?: number
  height?: number
}

export interface DesktopCaptureFrame {
  imageUrl: string
  width: number
  height: number
  timestamp: number
}

export interface DesktopCaptureModifiers {
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export interface DesktopCapturePointerEvent extends DesktopCaptureModifiers {
  sourceId: string
  type: 'pointerdown' | 'pointerup' | 'pointermove' | 'click' | 'dblclick' | 'wheel'
  x: number
  y: number
  normalizedX: number
  normalizedY: number
  button?: number
  buttons?: number
  deltaX?: number
  deltaY?: number
}

export interface DesktopCaptureKeyEvent extends DesktopCaptureModifiers {
  sourceId: string
  type: 'keydown' | 'keyup'
  key: string
  code?: string
  repeat?: boolean
}

export interface OasisDesktopCaptureBridge {
  isAvailable?: () => boolean | Promise<boolean>
  listSources?: (options?: { types?: DesktopCaptureSourceKind[] }) => Promise<DesktopCaptureSource[]>
  openPicker?: (options?: { types?: DesktopCaptureSourceKind[] }) => Promise<DesktopCaptureSource | null>
  captureFrame?: (options: { sourceId: string; width?: number; height?: number }) => Promise<DesktopCaptureFrame | null>
  focusSource?: (options: { sourceId: string }) => Promise<void> | void
  sendPointerEvent?: (event: DesktopCapturePointerEvent) => Promise<void> | void
  sendKeyEvent?: (event: DesktopCaptureKeyEvent) => Promise<void> | void
  sendTextInput?: (options: { sourceId: string; text: string }) => Promise<void> | void
}

export function getDesktopCaptureBridge(): OasisDesktopCaptureBridge | null {
  if (typeof window === 'undefined') return null
  return window.oasisDesktopCapture || null
}

export function clampDesktopCaptureFps(fps?: number): number {
  return Math.min(60, Math.max(1, Math.round(fps ?? 24)))
}

export function normalizeBrowserSurfaceUrl(input?: string | null): string {
  const trimmed = input?.trim() || ''
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}
