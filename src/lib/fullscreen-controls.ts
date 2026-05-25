'use client'

type FullscreenTarget = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void> | void
}

function fullscreenDocument(): FullscreenDocument | null {
  if (typeof document === 'undefined') return null
  return document as FullscreenDocument
}

export function isFullscreenActive(): boolean {
  const doc = fullscreenDocument()
  return Boolean(doc?.fullscreenElement || doc?.webkitFullscreenElement)
}

export function canRequestFullscreen(): boolean {
  const doc = fullscreenDocument()
  if (!doc) return false
  const target = document.documentElement as FullscreenTarget
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled || target.requestFullscreen || target.webkitRequestFullscreen)
}

export async function requestOasisFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const targets = [
    document.documentElement,
    document.querySelector('canvas'),
    document.body,
  ].filter(Boolean) as FullscreenTarget[]

  for (const target of targets) {
    if (target.requestFullscreen) {
      try {
        await target.requestFullscreen({ navigationUI: 'hide' })
        return true
      } catch {}
    }
    if (target.webkitRequestFullscreen) {
      try {
        await target.webkitRequestFullscreen()
        return true
      } catch {}
    }
  }
  return false
}

export async function exitOasisFullscreen(): Promise<boolean> {
  const doc = fullscreenDocument()
  if (!doc) return false
  if (doc.exitFullscreen && doc.fullscreenElement) {
    try {
      await doc.exitFullscreen()
      return true
    } catch {}
  }
  if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
    try {
      await doc.webkitExitFullscreen()
      return true
    } catch {}
  }
  return false
}

export async function setOasisFullscreen(active: boolean): Promise<boolean> {
  if (active) return requestOasisFullscreen()
  return exitOasisFullscreen()
}

