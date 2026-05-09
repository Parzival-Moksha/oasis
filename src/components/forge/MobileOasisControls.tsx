'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pushMouseLookDelta, useInputManager } from '@/lib/input-manager'
import { isProbablyMobileDevice, useMobileControls } from '@/lib/mobile-controls'

const PAD_RADIUS = 48
const MOBILE_LOOK_MULTIPLIER = 2.1
const LOOK_DEADZONE_PX = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function useIsMobileOasis(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const update = () => setIsMobile(isProbablyMobileDevice())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return isMobile
}

export function MobileOasisControls({ enabled }: { enabled: boolean }) {
  const setMove = useMobileControls(s => s.setMove)
  const setSprint = useMobileControls(s => s.setSprint)
  const setLookActive = useMobileControls(s => s.setLookActive)
  const reset = useMobileControls(s => s.reset)
  const [thumb, setThumb] = useState({ x: 0, y: 0 })
  const movePointerIdRef = useRef<number | null>(null)
  const moveCenterRef = useRef({ x: 0, y: 0 })
  const lookPointerRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    if (!enabled) {
      reset()
      setThumb({ x: 0, y: 0 })
    }
  }, [enabled, reset])

  useEffect(() => {
    if (!enabled) return
    const canvas = document.querySelector('#uploader-canvas') as HTMLElement | null
    if (!canvas) return
    const previousTouchAction = canvas.style.touchAction
    canvas.style.touchAction = 'none'
    return () => {
      canvas.style.touchAction = previousTouchAction
      lookPointerRef.current = null
      setLookActive(false)
    }
  }, [enabled, setLookActive])

  if (!enabled) return null

  const canLook = () => {
    const state = useInputManager.getState()
    return state.can().mouseLook && !state.hasActiveUILayer()
  }

  const beginLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || !canLook()) return
    event.preventDefault()
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    lookPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    setLookActive(true)
  }

  const updateLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = lookPointerRef.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()

    if (!canLook()) {
      lookPointerRef.current = null
      setLookActive(false)
      return
    }

    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    const moved = active.moved || Math.hypot(dx, dy) > LOOK_DEADZONE_PX
    if (moved) {
      pushMouseLookDelta(dx * MOBILE_LOOK_MULTIPLIER, dy * MOBILE_LOOK_MULTIPLIER, event.timeStamp)
    }
    lookPointerRef.current = { id: active.id, x: event.clientX, y: event.clientY, moved }
  }

  const endLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointerRef.current?.id !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {}
    lookPointerRef.current = null
    setLookActive(false)
  }

  const updateMove = (clientX: number, clientY: number) => {
    const dx = clientX - moveCenterRef.current.x
    const dy = clientY - moveCenterRef.current.y
    const length = Math.hypot(dx, dy)
    const ratio = length > PAD_RADIUS ? PAD_RADIUS / length : 1
    const x = dx * ratio
    const y = dy * ratio
    setThumb({ x, y })
    setMove(clamp(x / PAD_RADIUS, -1, 1), clamp(-y / PAD_RADIUS, -1, 1))
  }

  const resetMove = () => {
    movePointerIdRef.current = null
    setThumb({ x: 0, y: 0 })
    setMove(0, 0)
  }

  const endMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (movePointerIdRef.current !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {}
    resetMove()
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[185] touch-none select-none">
      <div
        aria-hidden="true"
        className="pointer-events-auto absolute inset-y-0 right-0 w-[60vw] touch-none"
        onPointerDown={beginLook}
        onPointerMove={updateLook}
        onPointerUp={endLook}
        onPointerCancel={endLook}
      />

      <div
        className="pointer-events-auto absolute bottom-6 left-5 h-28 w-28 touch-none rounded-full border border-cyan-200/24 bg-black/35 shadow-[0_0_30px_rgba(34,211,238,0.16)] backdrop-blur-sm"
        onPointerDown={event => {
          event.preventDefault()
          event.stopPropagation()
          movePointerIdRef.current = event.pointerId
          const rect = event.currentTarget.getBoundingClientRect()
          moveCenterRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          event.currentTarget.setPointerCapture(event.pointerId)
          updateMove(event.clientX, event.clientY)
        }}
        onPointerMove={event => {
          if (movePointerIdRef.current !== event.pointerId) return
          event.preventDefault()
          event.stopPropagation()
          updateMove(event.clientX, event.clientY)
        }}
        onPointerUp={endMove}
        onPointerCancel={endMove}
      >
        <div className="absolute inset-4 rounded-full border border-white/12" />
        <div
          className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/40 bg-cyan-200/18 shadow-[0_0_22px_rgba(125,211,252,0.28)]"
          style={{ transform: `translate(calc(-50% + ${thumb.x}px), calc(-50% + ${thumb.y}px))` }}
        />
      </div>

      <div className="pointer-events-auto absolute bottom-7 right-5 flex touch-none flex-col gap-2">
        <button
          type="button"
          className="h-11 min-w-20 touch-none rounded-lg border border-amber-200/35 bg-black/45 px-4 text-[11px] font-black uppercase tracking-[0.14em] text-amber-100 shadow-[0_0_28px_rgba(251,191,36,0.16)] backdrop-blur-sm"
          onPointerDown={event => {
            event.preventDefault()
            event.stopPropagation()
            setSprint(true)
          }}
          onPointerUp={event => {
            event.preventDefault()
            event.stopPropagation()
            setSprint(false)
          }}
          onPointerCancel={event => {
            event.preventDefault()
            event.stopPropagation()
            setSprint(false)
          }}
        >
          Run
        </button>
      </div>
    </div>
  )
}
