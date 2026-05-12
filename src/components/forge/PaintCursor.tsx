// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PAINT CURSOR ░▒▓█ The wand-tip raycaster + stroke writer █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ Hold to paint. Strokes ride the multiplayer mutation channel ─═̷─═̷─ॐ─═̷─═̷─
//
// Sampling lives in useFrame, NOT pointermove — that way WASD/QE camera motion
// (and pointer-locked mouselook) records points even when no pointer event
// fires. The pointer event handlers now just bracket the stroke (down=start,
// up=end) and cache the latest cursor for the unlocked case.
//
// In pointer-locked modes (noclip, third-person, paint) the OS cursor freezes
// at the moment of lock and clientX/Y go stale. We force NDC (0,0) — strokes
// always land on the crosshair, matching the existing PointerLockRaycaster
// fix in Scene.tsx.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import {
  PAINT_MAX_POINTS,
  PAINT_MIN_POINT_DISTANCE,
  distanceBetween,
  makeStrokeId,
  type PaintStroke,
} from '@/lib/forge/paint-stroke'
import {
  appendLiveStrokePoint,
  endLiveStroke,
  startLiveStroke,
} from '@/lib/forge/live-strokes'
import { worldMutationBus } from '@/lib/world-mutation-bus'
import { useOasisStore } from '@/store/oasisStore'
import { Sparkler } from './Sparkler'

const SAMPLE_INTERVAL_MS = 33

interface PaintCursorProps {
  /** When false, the cursor is dormant — no events captured, no sparkler. */
  active: boolean
  /** Stable id for this client (paired with author color tint on the sparkler). */
  authorId: string
  /** Author color used to tint the wand-tip sparkler. */
  authorColor: string
}

export function PaintCursor({ active, authorId, authorColor }: PaintCursorProps) {
  const { gl, camera } = useThree()
  const settings = useOasisStore(s => s.paintBrushSettings)
  const addPaintStroke = useOasisStore(s => s.addPaintStroke)

  // Sparkler position — only set during active painting, cleared on finish.
  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number] | null>(null)

  // Mutable per-stroke state — refs so we don't trigger re-renders mid-drag.
  const strokeIdRef = useRef<string | null>(null)
  const lastSampleAtRef = useRef(0)
  const lastSampleRef = useRef<[number, number, number] | null>(null)
  const pointCountRef = useRef(0)
  const allPointsRef = useRef<number[]>([])
  // Latest cursor position from pointer events — only used in non-pointer-lock
  // mode (when we actually have a meaningful clientX/Y). In pointer-lock we
  // ignore it and use NDC (0,0).
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  // Pinned style for the current drag — locked at pointerdown so panel wiggles
  // mid-stroke don't change thickness/color halfway through.
  const styleRef = useRef(settings)
  // Live settings ref — read inside event handlers + useFrame so the effect
  // can keep its dep array short.
  const liveSettingsRef = useRef(settings)
  useEffect(() => { liveSettingsRef.current = settings }, [settings])

  const projectPointerToWorld = useCallback((clientX: number, clientY: number): [number, number, number] | null => {
    const dom = gl.domElement
    let ndcX: number
    let ndcY: number
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      // Pointer-locked: cursor is invisible and clientX/Y are stale, paint
      // from screen center (the crosshair).
      ndcX = 0
      ndcY = 0
    } else {
      const rect = dom.getBoundingClientRect()
      ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
      ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1)
    }
    const ndc = new THREE.Vector3(ndcX, ndcY, 0.5)
    ndc.unproject(camera)
    const dir = ndc.sub(camera.position).normalize()
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const planeOrigin = camera.position.clone().addScaledVector(fwd, styleRef.current.distance)
    const denom = dir.dot(fwd)
    if (Math.abs(denom) < 1e-5) return null
    const t = planeOrigin.clone().sub(camera.position).dot(fwd) / denom
    if (t <= 0) return null
    const point = camera.position.clone().addScaledVector(dir, t)
    return [point.x, point.y, point.z]
  }, [gl, camera])

  const sampleIfDue = useCallback((point: [number, number, number]): boolean => {
    const now = performance.now()
    const dueByTime = now - lastSampleAtRef.current >= SAMPLE_INTERVAL_MS
    const last = lastSampleRef.current
    const dueByDistance = !last || distanceBetween(point, last) >= PAINT_MIN_POINT_DISTANCE
    if (!dueByTime && !dueByDistance) return false
    if (pointCountRef.current >= PAINT_MAX_POINTS) return false
    if (last && distanceBetween(point, last) < 1e-4) return false
    lastSampleAtRef.current = now
    lastSampleRef.current = point
    pointCountRef.current += 1
    allPointsRef.current.push(point[0], point[1], point[2])
    return true
  }, [])

  // Per-frame sampler — runs ONLY while a stroke is in progress. Decoupling
  // from pointer events lets the user drag a continuous stroke while moving
  // with WASD/QE (no mouse motion needed) and lets pointer-locked mouselook
  // record strokes even though clientX/Y are stale.
  useFrame(() => {
    const id = strokeIdRef.current
    if (!id || !active) return
    const point = projectPointerToWorld(lastPointerRef.current.x, lastPointerRef.current.y)
    if (!point) return
    const sampled = sampleIfDue(point)
    if (sampled) {
      setCursorWorldPos(point)
      appendLiveStrokePoint(id, point)
      worldMutationBus.broadcast({ kind: 'stroke_pointed', payload: { strokeId: id, point } })
    }
  })

  useEffect(() => {
    if (!active) {
      // Deactivating mid-stroke: finalize gracefully + clear sparkler.
      if (strokeIdRef.current) finishStroke()
      setCursorWorldPos(null)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const dom = gl.domElement

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      // Lock in style for this stroke (panel wiggles mid-stroke don't apply).
      styleRef.current = liveSettingsRef.current
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      const startPoint = projectPointerToWorld(event.clientX, event.clientY)
      if (!startPoint) return
      event.preventDefault()
      event.stopPropagation()
      try { dom.setPointerCapture(event.pointerId) } catch { /* not all platforms */ }

      const strokeId = makeStrokeId()
      strokeIdRef.current = strokeId
      lastSampleAtRef.current = performance.now()
      lastSampleRef.current = startPoint
      pointCountRef.current = 1
      allPointsRef.current = [startPoint[0], startPoint[1], startPoint[2]]

      startLiveStroke({
        id: strokeId,
        authorId,
        authorColor,
        style: styleRef.current,
        firstPoint: startPoint,
      })
      worldMutationBus.broadcast({
        kind: 'stroke_started',
        payload: { strokeId, authorId, authorColor, style: styleRef.current },
      })
      worldMutationBus.broadcast({
        kind: 'stroke_pointed',
        payload: { strokeId, point: startPoint },
      })
      setCursorWorldPos(startPoint)
    }

    const onPointerMove = (event: PointerEvent) => {
      // Just cache the latest pointer for the unlocked case. Sampling is
      // useFrame's job. While locked the cached coords are ignored anyway.
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      if (strokeIdRef.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!strokeIdRef.current) return
      event.preventDefault()
      event.stopPropagation()
      try { dom.releasePointerCapture(event.pointerId) } catch { /* */ }
      finishStroke()
    }

    // pointercancel reports button === -1, so the up-handler's button guard
    // would skip it and orphan the stroke. Always finalize on cancel.
    const onPointerCancel = (event: PointerEvent) => {
      if (!strokeIdRef.current) return
      event.preventDefault()
      event.stopPropagation()
      try { dom.releasePointerCapture(event.pointerId) } catch { /* */ }
      finishStroke()
    }

    dom.addEventListener('pointerdown', onPointerDown, { capture: true })
    dom.addEventListener('pointermove', onPointerMove, { capture: true })
    dom.addEventListener('pointerup', onPointerUp, { capture: true })
    dom.addEventListener('pointercancel', onPointerCancel, { capture: true })

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions)
      dom.removeEventListener('pointermove', onPointerMove, { capture: true } as EventListenerOptions)
      dom.removeEventListener('pointerup', onPointerUp, { capture: true } as EventListenerOptions)
      dom.removeEventListener('pointercancel', onPointerCancel, { capture: true } as EventListenerOptions)
    }
    // `settings` is intentionally NOT in the dep array — read via the
    // liveSettingsRef inside handlers. Otherwise we'd retear down every
    // listener on every panel slider change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, authorId, authorColor, gl, camera])

  function finishStroke() {
    const strokeId = strokeIdRef.current
    if (!strokeId) return
    strokeIdRef.current = null
    const points = allPointsRef.current
    const style = styleRef.current
    const finalStroke: PaintStroke = {
      id: strokeId,
      type: 'paint_stroke',
      points,
      color: style.color,
      thickness: style.thickness,
      shininess: style.shininess,
      mode: style.mode,
      varyByVelocity: style.varyByVelocity,
      authorId,
      authorColor,
      createdAt: Date.now(),
    }
    if (points.length >= 6) {
      addPaintStroke(finalStroke)
    }
    worldMutationBus.broadcast({ kind: 'stroke_ended', payload: { strokeId, finalStroke } })
    endLiveStroke(strokeId)
    allPointsRef.current = []
    pointCountRef.current = 0
    lastSampleRef.current = null
    setCursorWorldPos(null)
  }

  if (!active) return null
  return cursorWorldPos ? (
    <Sparkler position={cursorWorldPos} color={authorColor} active intensity={1} />
  ) : null
}
