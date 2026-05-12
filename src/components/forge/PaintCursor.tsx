// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PAINT CURSOR ░▒▓█ The wand-tip raycaster + stroke writer █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ Hold to paint. Strokes ride the multiplayer mutation channel ─═̷─═̷─ॐ─═̷─═̷─
//
// Pointer-down → start stroke. Pointer-move → sample at distance D from camera,
// throttle by 10cm and ~30Hz. Pointer-up → finalize, broadcast, persist.
// Disables OrbitControls (and absorbs canvas pointer events) while held.
// Renders a Sparkler at the live cursor point even before pointer-down so the
// wand-tip wizardry is constantly visible while paint mode is engaged.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
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

  // Local cursor world position — updated on pointer move (and during draw).
  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number] | null>(null)

  // Mutable per-stroke state — refs so we don't trigger re-renders mid-drag.
  const strokeIdRef = useRef<string | null>(null)
  const lastSampleAtRef = useRef(0)
  const lastSampleRef = useRef<[number, number, number] | null>(null)
  const pointCountRef = useRef(0)
  const allPointsRef = useRef<number[]>([])
  // Pinned style for the current drag — locked at pointerdown so panel wiggles
  // mid-stroke don't change thickness/color halfway through.
  const styleRef = useRef(settings)
  // Live settings ref — read inside event handlers so the effect can keep its
  // dep array short (without this, every panel tweak retears down the capture
  // listeners and a pending pointer-capture token could get lost).
  const liveSettingsRef = useRef(settings)
  useEffect(() => { liveSettingsRef.current = settings }, [settings])

  useEffect(() => {
    if (!active) {
      // If we deactivate mid-stroke, finalize gracefully.
      if (strokeIdRef.current) finishStroke()
      setCursorWorldPos(null)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const dom = gl.domElement

    const projectPointerToWorld = (clientX: number, clientY: number): [number, number, number] | null => {
      // When the pointer is locked (noclip/third-person mouse-look), the OS
      // cursor is invisible and clientX/clientY are STALE — they hold the
      // last position before lock. Painting from that stale position drifts
      // the stroke off the crosshair in random directions (drift direction =
      // wherever the cursor was when lock engaged minus screen center).
      // Force NDC center while locked so strokes always land on the
      // crosshair, matching the existing PointerLockRaycaster fix in Scene.tsx.
      let ndcX: number
      let ndcY: number
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        ndcX = 0
        ndcY = 0
      } else {
        const rect = dom.getBoundingClientRect()
        ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
        ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1)
      }
      // Build a ray from the camera through the (NDC) cursor.
      const ndc = new THREE.Vector3(ndcX, ndcY, 0.5)
      ndc.unproject(camera)
      const dir = ndc.sub(camera.position).normalize()
      // Intersect the ray with a plane perpendicular to the camera forward at distance D.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      const planeOrigin = camera.position.clone().addScaledVector(fwd, styleRef.current.distance)
      const denom = dir.dot(fwd)
      if (Math.abs(denom) < 1e-5) return null
      const t = planeOrigin.clone().sub(camera.position).dot(fwd) / denom
      if (t <= 0) return null
      const point = camera.position.clone().addScaledVector(dir, t)
      return [point.x, point.y, point.z]
    }

    const sampleIfDue = (point: [number, number, number]): boolean => {
      const now = performance.now()
      const dueByTime = now - lastSampleAtRef.current >= SAMPLE_INTERVAL_MS
      const last = lastSampleRef.current
      const dueByDistance = !last || distanceBetween(point, last) >= PAINT_MIN_POINT_DISTANCE
      // OR-gate the filters (used to be AND): slow careful artistic drags
      // could starve forever waiting for 10cm net travel between frames.
      // Now we sample when EITHER the cadence elapsed OR the distance hit.
      // The PAINT_MAX_POINTS cap still bounds total stroke complexity.
      if (!dueByTime && !dueByDistance) return false
      if (pointCountRef.current >= PAINT_MAX_POINTS) return false
      // Avoid coincident-point geometry NaNs: skip if literally identical.
      if (last && distanceBetween(point, last) < 1e-4) return false
      lastSampleAtRef.current = now
      lastSampleRef.current = point
      pointCountRef.current += 1
      allPointsRef.current.push(point[0], point[1], point[2])
      return true
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      // Lock in style for this stroke; capture pointer so move/up land on us
      // even if the cursor leaves the canvas mid-drag. Use the live ref so a
      // stale closure can't pin yesterday's settings to today's stroke.
      styleRef.current = liveSettingsRef.current
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
      const id = strokeIdRef.current
      // Only do work while a stroke is in progress. Without an active stroke,
      // pointer moves are just hovering — we don't want the wand-tip sparkler
      // to render whenever the cursor is over the canvas, only while the
      // user is actively painting (LMB held). This is also a fast path for
      // mouse-look in pointer-locked modes (no allocations, no broadcasts).
      if (!id) return
      const point = projectPointerToWorld(event.clientX, event.clientY)
      if (!point) return
      setCursorWorldPos(point)
      event.preventDefault()
      event.stopPropagation()
      const sampled = sampleIfDue(point)
      if (sampled) {
        appendLiveStrokePoint(id, point)
        worldMutationBus.broadcast({ kind: 'stroke_pointed', payload: { strokeId: id, point } })
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

    // pointercancel reports button === -1 (not 0), so the up-handler's button
    // guard would skip it and orphan the stroke. Always finalize on cancel.
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
    // `settings` is intentionally NOT in the dep array — read via
    // liveSettingsRef inside the handlers. Otherwise we'd retear down every
    // listener on every panel slider change, possibly losing in-flight
    // pointer capture mid-stroke.
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
    // Add locally first; then broadcast end so receivers can replace their
    // live in-progress stroke with the persisted object atomically.
    if (points.length >= 6) {
      addPaintStroke(finalStroke)
    }
    worldMutationBus.broadcast({ kind: 'stroke_ended', payload: { strokeId, finalStroke } })
    endLiveStroke(strokeId)
    allPointsRef.current = []
    pointCountRef.current = 0
    lastSampleRef.current = null
    // Drop the cursor so the wand-tip sparkler vanishes the instant the user
    // releases the mouse — it should only be visible during active painting.
    setCursorWorldPos(null)
  }

  if (!active) return null
  return cursorWorldPos ? (
    <Sparkler position={cursorWorldPos} color={authorColor} active intensity={1} />
  ) : null
}
