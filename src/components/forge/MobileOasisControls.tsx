'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pushMouseLookDelta, useInputManager } from '@/lib/input-manager'
import { isProbablyMobileDevice, useMobileControls } from '@/lib/mobile-controls'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { findNearestSpatialWebObject, SPATIAL_WEB_INTERACTION_RADIUS, type SpatialWebObject } from '@/lib/spatial-web'
import { useOasisStore } from '@/store/oasisStore'
import type { SpellId } from '@/lib/spellbook'

const PAD_RADIUS = 48
const MOBILE_LOOK_MULTIPLIER = 2.1
const LOOK_DEADZONE_PX = 4

function spatialActionLabel(object: SpatialWebObject): { label: string; disabled: boolean } {
  if (object.visualStyle === 'google-form-altar') {
    return { label: object.generatedWorldUrl ? 'Copy text' : 'Create', disabled: false }
  }
  if (object.type === 'button' && object.action?.type === 'submit_form') {
    return { label: object.submittedAt ? 'Sent' : 'Send', disabled: Boolean(object.submittedAt) }
  }
  if (object.type === 'text') return { label: 'Edit', disabled: false }
  if (object.type === 'slider') return { label: 'Adjust', disabled: false }
  return { label: 'Interact', disabled: false }
}

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

export function MobileOasisControls({
  enabled,
  spellControlsEnabled = false,
}: {
  enabled: boolean
  spellControlsEnabled?: boolean
}) {
  const setMove = useMobileControls(s => s.setMove)
  const setSprint = useMobileControls(s => s.setSprint)
  const setLookActive = useMobileControls(s => s.setLookActive)
  const reset = useMobileControls(s => s.reset)
  const [thumb, setThumb] = useState({ x: 0, y: 0 })
  const [nearbyAction, setNearbyAction] = useState<{ id: string; label: string; disabled: boolean } | null>(null)
  const movePointerIdRef = useRef<number | null>(null)
  const moveCenterRef = useRef({ x: 0, y: 0 })
  const lookPointerRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  // When paint mode is armed, the look-overlay must hand its events through to
  // the canvas underneath so PaintCursor sees the drag.
  const paintHeldActive = useOasisStore(s => s.paintHeldActive)

  useEffect(() => {
    if (!enabled) {
      reset()
      setThumb({ x: 0, y: 0 })
      setNearbyAction(null)
    }
  }, [enabled, reset])

  useEffect(() => {
    if (!enabled) return

    const updateNearbyAction = () => {
      const pose = getPlayerAvatarPose()
      const state = useOasisStore.getState()
      const nearest = findNearestSpatialWebObject(
        state.spatialWebObjects,
        pose?.position || null,
        state.transforms,
        SPATIAL_WEB_INTERACTION_RADIUS,
      )
      if (!nearest) {
        setNearbyAction(null)
        return
      }
      const action = spatialActionLabel(nearest)
      setNearbyAction({ id: nearest.id, ...action })
    }

    updateNearbyAction()
    const timer = window.setInterval(updateNearbyAction, 160)
    return () => window.clearInterval(timer)
  }, [enabled])

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
      {/* Full-canvas look surface — covers the entire viewport so any finger
          drag rotates the camera (mobile feel). Joystick + action buttons are
          siblings later in DOM order with their own pointer-events-auto, so
          they sit ABOVE this overlay and keep working. When the user holds
          the Paint button, this overlay disables its own pointer-events so
          drags flow through to PaintCursor on the canvas underneath. */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 touch-none ${paintHeldActive ? 'pointer-events-none' : 'pointer-events-auto'}`}
        onPointerDown={beginLook}
        onPointerMove={updateLook}
        onPointerUp={endLook}
        onPointerCancel={endLook}
      />

      {/* ░▒▓ DASH button — above the WASD ring. Index finger holds it down
          while thumb steers the joystick. Right thumb stays free for action
          buttons on the right side. ▓▒░ */}
      <button
        type="button"
        className="pointer-events-auto absolute bottom-40 left-5 h-12 w-28 touch-none rounded-lg border border-amber-200/45 bg-amber-950/72 text-[11px] font-black uppercase tracking-[0.18em] text-amber-100 shadow-[0_0_28px_rgba(251,191,36,0.22)] backdrop-blur-sm"
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
        Dash
      </button>

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
        <MobilePrimaryActionButton nearbyAction={nearbyAction} spellControlsEnabled={spellControlsEnabled} />
        {spellControlsEnabled && <MobileManaButton />}
        <MobilePaintHoldButton />
      </div>
    </div>
  )
}

const COMBAT_SPELL_IDS: SpellId[] = ['firebolt', 'lightning-bolt', 'ice-bolt']
function isCombatSpell(id: SpellId | null): boolean {
  return id !== null && COMBAT_SPELL_IDS.includes(id)
}

// ─═̷─═̷─🖱─═̷─═̷─{ MOBILE PRIMARY-ACTION BUTTON — the touch equivalent of LMB }─═̷─═̷─🖱─═̷─═̷─
//
// One button, bottom-right, ALWAYS visible. On tap it synthesizes a real
// PointerEvent stack (pointerdown + pointerup + click) on the canvas DOM
// element at screen-center coordinates — i.e. exactly where the mobile
// crosshair points. React Three Fiber's event system handles synthetic
// events through the normal pipeline: it runs the raycaster against the
// current camera, finds the hit, and fires the matching `onClick` /
// `onPointerDown` handler. Means we route through the SAME code paths as
// desktop LMB — no per-interaction wiring required.
//
// Label morphs based on context (PLACE / FIRE / SELECT / spatial-web
// custom). Spatial-web interactions are the one exception: those fire by
// proximity, not by aim, so when a nearbyAction is present we call the
// store helper directly instead of synthesizing a click.
//
// Pro-studio precedent: Unity/Unreal/Godot input systems all abstract input
// source from action. This is the minimal-refactor equivalent.
// ─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─

function dispatchSyntheticLeftClick(): boolean {
  if (typeof document === 'undefined') return false
  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
  if (!canvas) return false
  const rect = canvas.getBoundingClientRect()
  const clientX = rect.left + rect.width / 2
  const clientY = rect.top + rect.height / 2
  const opts: PointerEventInit = {
    clientX,
    clientY,
    button: 0,
    buttons: 1,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  }
  canvas.dispatchEvent(new PointerEvent('pointerdown', opts))
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
  canvas.dispatchEvent(new MouseEvent('click', { clientX, clientY, button: 0, bubbles: true, cancelable: true }))
  return true
}

function MobilePrimaryActionButton({
  nearbyAction,
  spellControlsEnabled,
}: {
  nearbyAction: { id: string; label: string; disabled: boolean } | null
  spellControlsEnabled: boolean
}) {
  const placementPending = useOasisStore(s => s.placementPending)
  const selectedSpellId = useOasisStore(s => s.selectedSpellId)
  const paintMode = useOasisStore(s => s.paintMode)

  // Compute label + tone + handler from current context.
  let label = 'Select'
  let tone: 'amber' | 'amber-pulse' | 'rose' | 'cyan' | 'emerald' = 'amber'
  let disabled = false
  let onTap: () => void

  if (nearbyAction) {
    label = nearbyAction.label
    tone = 'cyan'
    disabled = nearbyAction.disabled
    onTap = () => {
      if (nearbyAction.disabled) return
      void useOasisStore.getState().interactSpatialWebObject(nearbyAction.id, 'press')
    }
  } else if (placementPending) {
    label = 'Place'
    tone = 'amber-pulse'
    onTap = () => { dispatchSyntheticLeftClick() }
  } else if (spellControlsEnabled && isCombatSpell(selectedSpellId) && selectedSpellId) {
    // FIRE button reads the spell name from the registry — works for firebolt
    // today, ready for lightning/ice once their cast paths land.
    label = selectedSpellId === 'firebolt' ? 'Fire'
      : selectedSpellId === 'lightning-bolt' ? 'Bolt'
      : 'Ice'
    tone = 'rose'
    onTap = () => { dispatchSyntheticLeftClick() }
  } else if (paintMode) {
    label = 'Paint'
    tone = 'emerald'
    onTap = () => { dispatchSyntheticLeftClick() }
  } else {
    onTap = () => { dispatchSyntheticLeftClick() }
  }

  const toneClasses: Record<typeof tone, string> = {
    'amber':       'border-amber-200/55 bg-amber-900/68 text-amber-50  shadow-[0_0_24px_rgba(251,191,36,0.28)]',
    'amber-pulse': 'border-amber-200/75 bg-amber-800/80 text-amber-50  shadow-[0_0_24px_rgba(251,191,36,0.4)]',
    'rose':        'border-rose-300/65  bg-rose-950/78  text-rose-50   shadow-[0_0_28px_rgba(244,63,94,0.35)]',
    'cyan':        'border-cyan-200/55  bg-cyan-950/72  text-cyan-50   shadow-[0_0_28px_rgba(34,211,238,0.3)]',
    'emerald':     'border-emerald-200/55 bg-emerald-950/72 text-emerald-50 shadow-[0_0_28px_rgba(16,185,129,0.32)]',
  }

  return (
    <>
      <style>{`
        @keyframes oasisPrimaryActionPulse {
          0%, 100% { box-shadow: 0 0 18px rgba(251,191,36,0.4), inset 0 0 4px rgba(251,191,36,0.55); transform: scale(1); }
          50%      { box-shadow: 0 0 38px rgba(251,191,36,0.85), inset 0 0 8px rgba(251,191,36,0.9); transform: scale(1.04); }
        }
      `}</style>
      <button
        type="button"
        disabled={disabled}
        className={`h-16 min-w-28 touch-none rounded-lg border-2 px-4 text-[12px] font-black uppercase tracking-[0.16em] backdrop-blur-sm transition disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-black/30 disabled:text-white/40 disabled:shadow-none ${toneClasses[tone]}`}
        style={tone === 'amber-pulse' ? { animation: 'oasisPrimaryActionPulse 1400ms ease-in-out infinite' } : undefined}
        onPointerDown={event => {
          event.preventDefault()
          event.stopPropagation()
          onTap()
        }}
      >
        {label}
      </button>
    </>
  )
}

function MobileManaButton() {
  const stop = () => window.dispatchEvent(new CustomEvent('oasis:mana-recharge-stop'))
  return (
    <button
      type="button"
      className="h-11 min-w-24 touch-none rounded-lg border border-cyan-200/45 bg-cyan-950/70 px-4 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-50 shadow-[0_0_30px_rgba(34,211,238,0.22)] backdrop-blur-sm"
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
        window.dispatchEvent(new CustomEvent('oasis:mana-recharge-start'))
      }}
      onPointerUp={event => {
        event.preventDefault()
        event.stopPropagation()
        try {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        } catch {}
        stop()
      }}
      onPointerCancel={event => {
        event.preventDefault()
        event.stopPropagation()
        stop()
      }}
    >
      Mana
    </button>
  )
}

// Held-paint button: while pressed, paint mode is armed so the OTHER finger
// (used for camera look) does not also trigger the wand. Releases on up/cancel.
// Hidden in read-only worlds — the wand is a write operation.
function MobilePaintHoldButton() {
  const setPaintHeldActive = useOasisStore(s => s.setPaintHeldActive)
  const brushSpellActive = useOasisStore(s => s.paintBrushPanelOpen)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)
  if (isReadOnly || !brushSpellActive) return null
  return (
    <button
      type="button"
      className="h-11 min-w-20 touch-none rounded-lg border border-fuchsia-300/40 bg-black/45 px-4 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-100 shadow-[0_0_28px_rgba(217,70,239,0.18)] backdrop-blur-sm"
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
        setPaintHeldActive(true)
      }}
      onPointerUp={event => {
        event.preventDefault()
        event.stopPropagation()
        setPaintHeldActive(false)
      }}
      onPointerCancel={event => {
        event.preventDefault()
        event.stopPropagation()
        setPaintHeldActive(false)
      }}
    >
      Paint
    </button>
  )
}
