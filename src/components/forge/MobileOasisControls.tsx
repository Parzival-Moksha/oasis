'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pushMouseLookDelta, useInputManager } from '@/lib/input-manager'
import { isProbablyMobileDevice, useMobileControls } from '@/lib/mobile-controls'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { findNearestSpatialWebObject, SPATIAL_WEB_INTERACTION_RADIUS, type SpatialWebObject } from '@/lib/spatial-web'
import { useOasisStore } from '@/store/oasisStore'
import type { SpellId } from '@/lib/spellbook'
import { PLAYER_BASE_STATS } from '@/lib/player-progression'

const PAD_RADIUS = 48
const MOBILE_LOOK_MULTIPLIER = 2.1
const LOOK_DEADZONE_PX = 4
const PINCH_ZOOM_SENSITIVITY = 0.0028

type TouchPoint = { x: number; y: number }
type FullscreenTarget = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void> | void
}

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

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function firstTwoTouchDistance(points: Map<number, TouchPoint>): number | null {
  const values = Array.from(points.values())
  if (values.length < 2) return null
  const [a, b] = values
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function dispatchTpsZoomDelta(delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) return
  window.dispatchEvent(new CustomEvent('oasis:tps-zoom-delta', { detail: { delta } }))
}

function getFullscreenDocument(): FullscreenDocument | null {
  if (typeof document === 'undefined') return null
  return document as FullscreenDocument
}

function canRequestFullscreen(): boolean {
  const doc = getFullscreenDocument()
  if (!doc) return false
  const target = document.documentElement as FullscreenTarget
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled || target.requestFullscreen || target.webkitRequestFullscreen)
}

function isFullscreenActive(): boolean {
  const doc = getFullscreenDocument()
  return Boolean(doc?.fullscreenElement || doc?.webkitFullscreenElement)
}

async function requestMobileFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const target = document.documentElement as FullscreenTarget
  try {
    if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' })
      return true
    }
    if (target.webkitRequestFullscreen) {
      await target.webkitRequestFullscreen()
      return true
    }
  } catch {
    return false
  }
  return false
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
  canDeleteSelected = false,
  onDeleteSelected,
}: {
  enabled: boolean
  spellControlsEnabled?: boolean
  canDeleteSelected?: boolean
  onDeleteSelected?: () => void
}) {
  const setMove = useMobileControls(s => s.setMove)
  const setSprint = useMobileControls(s => s.setSprint)
  const setLookActive = useMobileControls(s => s.setLookActive)
  const reset = useMobileControls(s => s.reset)
  const [thumb, setThumb] = useState({ x: 0, y: 0 })
  const [nearbyAction, setNearbyAction] = useState<{ id: string; kind: 'spatial'; label: string; disabled: boolean } | null>(null)
  const movePointerIdRef = useRef<number | null>(null)
  const moveCenterRef = useRef({ x: 0, y: 0 })
  const lookPointerRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const lookTouchesRef = useRef<Map<number, TouchPoint>>(new Map())
  const pinchRef = useRef<{ distance: number } | null>(null)
  // When paint mode is armed, the look-overlay must hand its events through to
  // the canvas underneath so PaintCursor sees the drag.
  const paintHeldActive = useOasisStore(s => s.paintHeldActive)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)
  const canvasNeedsTouch = paintHeldActive || (Boolean(selectedObjectId) && !isReadOnly)

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
      const actorPosition = pose?.position || null
      const nearest = findNearestSpatialWebObject(
        state.spatialWebObjects,
        actorPosition,
        state.transforms,
        SPATIAL_WEB_INTERACTION_RADIUS,
      )
      if (!nearest) {
        setNearbyAction(null)
        return
      }
      const action = spatialActionLabel(nearest)
      setNearbyAction({ id: nearest.id, kind: 'spatial', ...action })
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
    const trackedTouches = lookTouchesRef.current
    canvas.style.touchAction = 'none'
    return () => {
      canvas.style.touchAction = previousTouchAction
      lookPointerRef.current = null
      trackedTouches.clear()
      pinchRef.current = null
      setLookActive(false)
    }
  }, [enabled, setLookActive])

  if (!enabled) return null

  const canLook = () => {
    const state = useInputManager.getState()
    if (state.inputState === 'paint' && state.can().mouseLook) return true
    return state.can().mouseLook && !state.hasActiveUILayer()
  }

  const beginLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || !canLook()) return
    event.preventDefault()
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    if (event.pointerType === 'touch') {
      lookTouchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pinchDistance = firstTwoTouchDistance(lookTouchesRef.current)
      if (pinchDistance !== null) {
        pinchRef.current = { distance: pinchDistance }
        lookPointerRef.current = null
        setLookActive(false)
        return
      }
    }
    lookPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    setLookActive(true)
  }

  const updateLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && lookTouchesRef.current.has(event.pointerId)) {
      lookTouchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinchRef.current) {
        event.preventDefault()
        event.stopPropagation()
        const nextDistance = firstTwoTouchDistance(lookTouchesRef.current)
        if (nextDistance !== null) {
          dispatchTpsZoomDelta((pinchRef.current.distance - nextDistance) * PINCH_ZOOM_SENSITIVITY)
          pinchRef.current = { distance: nextDistance }
        }
        return
      }
    }
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
    const wasTrackedTouch = event.pointerType === 'touch' && lookTouchesRef.current.delete(event.pointerId)
    if (lookTouchesRef.current.size < 2) pinchRef.current = null
    if (lookPointerRef.current?.id !== event.pointerId && !wasTrackedTouch) return
    event.preventDefault()
    event.stopPropagation()
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {}
    if (lookPointerRef.current?.id === event.pointerId) {
      lookPointerRef.current = null
      setLookActive(false)
    }
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
    <div className="pointer-events-none fixed inset-0 z-[180] touch-none select-none">
      {/* Full-canvas look surface — covers the entire viewport so any finger
          drag rotates the camera (mobile feel). Joystick + action buttons are
          siblings later in DOM order with their own pointer-events-auto, so
          they sit ABOVE this overlay and keep working. When the user holds
          the Paint button or selects an object, this overlay disables its own
          pointer-events so drags flow through to PaintCursor / TransformControls
          on the canvas underneath. */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 touch-none ${canvasNeedsTouch ? 'pointer-events-none' : 'pointer-events-auto'}`}
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
        {/* ░▒▓ DASH button — moved to the right column so left thumb steers
            the WASD ring uninterrupted. Right thumb does SELECT / spells,
            right index can hold DASH above without thumb conflict. ▓▒░ */}
        <button
          type="button"
          className="h-11 min-w-28 touch-none rounded-lg border border-amber-200/45 bg-amber-950/72 px-4 text-[11px] font-black uppercase tracking-[0.18em] text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.22)] backdrop-blur-sm"
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
        <MobileFocusAgentButton />
        <MobilePrimaryActionButton nearbyAction={nearbyAction} spellControlsEnabled={spellControlsEnabled} />
        {canDeleteSelected && (
          <button
            type="button"
            className="h-11 min-w-28 touch-none rounded-lg border border-red-300/60 bg-red-950/82 px-4 text-[11px] font-black uppercase tracking-[0.16em] text-red-50 shadow-[0_0_26px_rgba(248,113,113,0.3)] backdrop-blur-sm"
            onPointerDown={event => {
              event.preventDefault()
              event.stopPropagation()
              onDeleteSelected?.()
            }}
            aria-label="Delete selected object"
          >
            Delete
          </button>
        )}
        {spellControlsEnabled && <MobileManaButton />}
        <MobilePaintHoldButton />
      </div>

      {/* ─═̷─ ESC button: bottom-center, just left of the mana cluster.
          Visible ONLY when in a focus-trap (agent-focus / ui-focused).
          Pinned bottom-6 so it sits above the WASD ring but below the
          HUD on mobile — keeps the rest of the UI completely calm
          until it's needed. ─═̷─ */}
      <div className="pointer-events-auto absolute bottom-7 left-1/2 -translate-x-1/2 touch-none">
        <MobileEscButton />
      </div>

      <MobileTransformHotbar />
      <MobileFullscreenPrompt />
    </div>
  )
}

const COMBAT_SPELL_IDS: SpellId[] = ['firebolt', 'lightning-bolt', 'ice-bolt']
function isCombatSpell(id: SpellId | null): boolean {
  return id !== null && COMBAT_SPELL_IDS.includes(id)
}

// ─═̷─═̷─🖱─═̷─═̷─{ MOBILE PRIMARY-ACTION BUTTON — the touch equivalent of LMB }─═̷─═̷─🖱─═̷─═̷─
//
// One button, bottom-right, ALWAYS visible. For world aim actions it
// synthesizes a real PointerEvent stack at the screen-center crosshair.
// Placement is the exception: it dispatches an explicit crosshair event so
// mobile PLACE cannot be dropped by a missed invisible-plane raycast.
//
// Label morphs based on context (PLACE / FIRE / SELECT / spatial-web
// custom). Spatial-web interactions also fire by proximity rather than aim,
// so when a nearbyAction is present we call the store helper directly.
//
// Pro-studio precedent: Unity/Unreal/Godot input systems all abstract input
// source from action. This is the minimal-refactor equivalent.
// ─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─

function MobileFullscreenPrompt() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isProbablyMobileDevice() || !canRequestFullscreen() || isFullscreenActive()) return
    try {
      if (window.sessionStorage.getItem('oasis-mobile-fullscreen-prompt-seen') === '1') return
    } catch {}
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 14000)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      className="pointer-events-auto absolute left-1/2 top-24 min-w-52 -translate-x-1/2 touch-none rounded-lg border-2 border-cyan-200/70 bg-slate-950/82 px-4 py-3 text-center text-cyan-50 shadow-[0_0_30px_rgba(34,211,238,0.36)] backdrop-blur-md"
      onPointerDown={async event => {
        event.preventDefault()
        event.stopPropagation()
        try { window.sessionStorage.setItem('oasis-mobile-fullscreen-prompt-seen', '1') } catch {}
        await requestMobileFullscreen()
        setVisible(false)
      }}
    >
      <div className="text-[12px] font-black uppercase tracking-[0.18em]">Go Fullscreen</div>
      <div className="mt-0.5 text-[10px] font-semibold text-cyan-100/75">for better experience</div>
    </button>
  )
}

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
  nearbyAction: { id: string; kind: 'spatial'; label: string; disabled: boolean } | null
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

  if (placementPending) {
    label = 'Place'
    tone = 'amber-pulse'
    onTap = () => {
      window.dispatchEvent(new CustomEvent('oasis:place-at-crosshair'))
    }
  } else if (nearbyAction) {
    label = nearbyAction.label
    tone = 'cyan'
    disabled = nearbyAction.disabled
    onTap = () => {
      if (nearbyAction.disabled) return
      void useOasisStore.getState().interactSpatialWebObject(nearbyAction.id, 'press')
    }
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
    onTap = () => { window.dispatchEvent(new CustomEvent('oasis:paint-at-crosshair')) }
  } else {
    onTap = () => { window.dispatchEvent(new CustomEvent('oasis:select-at-crosshair')) }
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

// ─═̷─═̷─🛠─═̷─═̷─{ MOBILE TRANSFORM HOTBAR — R/T/Y on selected objects }─═̷─═̷─🛠─═̷─═̷─
//
// Desktop has R/T/Y keys (`setTransformMode` in WorldObjects). On mobile
// there's no keyboard, so this hotbar appears at top-center whenever
// `selectedObjectId` is set, exposing the same three modes plus a quick
// deselect. Active mode is highlighted; tap to switch.
//
// Hidden on read-only worlds since transforms are write operations.
// ─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─

function MobileFocusAgentButton() {
  const agentWindowCount = useOasisStore(s => s.placedAgentWindows.length)
  if (agentWindowCount === 0) return null

  return (
    <button
      type="button"
      className="h-11 min-w-28 touch-none rounded-lg border border-sky-200/55 bg-sky-950/76 px-4 text-[11px] font-black uppercase tracking-[0.16em] text-sky-50 shadow-[0_0_24px_rgba(56,189,248,0.26)] backdrop-blur-sm"
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
        useOasisStore.getState().navigateAgentWindow(1)
      }}
      aria-label="Focus next agent window"
    >
      Focus
    </button>
  )
}

function MobileTransformHotbar() {
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const transformMode = useOasisStore(s => s.transformMode)
  const setTransformMode = useOasisStore(s => s.setTransformMode)
  const selectObject = useOasisStore(s => s.selectObject)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)

  if (!selectedObjectId || isReadOnly) return null

  // Same button vocabulary as DASH / SELECT / Mana — `h-11 min-w-X
  // rounded-lg border-2 bg-*-950/72 backdrop-blur-sm` with tone-shadow.
  // Active mode pulses with the same amber-glow tradition; inactive uses
  // the neutral DASH treatment so the cluster reads as one toolbar.
  const modes: { mode: 'translate' | 'rotate' | 'scale'; label: string }[] = [
    { mode: 'translate', label: 'Move' },
    { mode: 'rotate',    label: 'Rot' },
    { mode: 'scale',     label: 'Scale' },
  ]

  return (
    <div className="pointer-events-auto absolute right-5 top-20 flex touch-none flex-col gap-2">
      {modes.map(({ mode, label }) => {
        const active = transformMode === mode
        return (
          <button
            key={mode}
            type="button"
            className={`h-11 min-w-20 touch-none rounded-lg border-2 px-3 text-[11px] font-black uppercase tracking-[0.14em] backdrop-blur-sm transition ${
              active
                ? 'border-amber-200/75 bg-amber-900/80 text-amber-50 shadow-[0_0_28px_rgba(251,191,36,0.4)]'
                : 'border-amber-200/30 bg-amber-950/60 text-amber-100/70 shadow-[0_0_18px_rgba(251,191,36,0.14)]'
            }`}
            onPointerDown={event => {
              event.preventDefault()
              event.stopPropagation()
              setTransformMode(mode)
            }}
          >
            {label}
          </button>
        )
      })}
      <button
        type="button"
        className="h-11 min-w-20 touch-none rounded-lg border-2 border-rose-300/45 bg-rose-950/60 px-3 text-[11px] font-black uppercase tracking-[0.14em] text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.18)] backdrop-blur-sm transition"
        onPointerDown={event => {
          event.preventDefault()
          event.stopPropagation()
          selectObject(null)
        }}
        aria-label="Deselect"
      >
        Drop
      </button>
    </div>
  )
}

// ─═̷─🚪─═̷─{ MOBILE ESC BUTTON — the only way out of focus-traps on phone }─═̷─🚪─═̷─
//
// Desktop has Escape. Mobile has nothing — when a player hits F to talk to
// Merlin or wanders into pointer-locked agent-focus, there's literally no
// way back to the world. This button appears ONLY when input is in a
// trap state (`agent-focus` or `ui-focused`), pinned to the bottom-center
// column where thumbs can find it instantly. Tap → handleEscape() →
// restored to whichever camera mode you came from. Hidden otherwise so it
// doesn't clutter the normal control rail.
// ─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─═̷─

function MobileEscButton() {
  const inputState = useInputManager(s => s.inputState)
  const paintMode = useOasisStore(s => s.paintMode)
  const placementPending = useOasisStore(s => s.placementPending)
  const isTrapped = inputState === 'agent-focus' || inputState === 'ui-focused' || inputState === 'paint' || inputState === 'placement' || paintMode || Boolean(placementPending)

  if (!isTrapped) return null

  return (
    <button
      type="button"
      className="h-11 min-w-24 touch-none rounded-lg border border-rose-300/55 bg-rose-950/82 px-4 text-[11px] font-black uppercase tracking-[0.14em] text-rose-50 shadow-[0_0_30px_rgba(244,63,94,0.36)] backdrop-blur-sm"
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
        const store = useOasisStore.getState()
        if (store.paintMode) {
          store.exitPaintMode()
          store.setTerrainBrushPanelOpen(false)
          return
        }
        if (useInputManager.getState().inputState === 'paint') {
          store.setTerrainBrushPanelOpen(false)
          useInputManager.getState().handleEscape()
          return
        }
        if (store.placementPending) {
          store.cancelPlacement()
          return
        }
        useInputManager.getState().handleEscape()
      }}
      aria-label="Escape focus / agent lock"
    >
      Esc
    </button>
  )
}

type MobileManaSource = {
  mana?: unknown
  maxMana?: unknown
  stats?: { maxMana?: unknown } | null
  playerStats?: { maxMana?: unknown } | null
}

function canRechargeMana(source: MobileManaSource | null | undefined): boolean {
  const stats = source?.stats || source?.playerStats || {}
  const maxMana = Math.max(1, finiteNumber(source?.maxMana ?? stats.maxMana, PLAYER_BASE_STATS.mana))
  const mana = Math.max(0, Math.min(maxMana, finiteNumber(source?.mana, maxMana)))
  return mana < maxMana
}

function MobileManaButton() {
  const [visible, setVisible] = useState(false)
  const stop = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('oasis:mana-recharge-stop'))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const apply = (source: MobileManaSource | null | undefined) => {
      if (!cancelled) setVisible(canRechargeMana(source))
    }
    fetch('/api/profile', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(apply)
      .catch(() => {})
    const onVitals = (event: Event) => apply((event as CustomEvent<MobileManaSource>).detail)
    window.addEventListener('oasis:player-vitals', onVitals)
    return () => {
      cancelled = true
      window.removeEventListener('oasis:player-vitals', onVitals)
      stop()
    }
  }, [stop])

  useEffect(() => {
    if (!visible) stop()
  }, [stop, visible])

  if (!visible) return null

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
