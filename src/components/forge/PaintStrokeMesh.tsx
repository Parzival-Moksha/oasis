// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PAINT STROKE MESH ░▒▓█ Procedural tubes/ribbons rebuilt from point lists █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ Two render paths: smooth Catmull-Rom tube (3D) or thin line (2D) ─═̷─═̷─ॐ─═̷─═̷─
//
// 3D mode: TubeGeometry along a CatmullRomCurve3, MeshStandardMaterial.
//          When `varyByVelocity` is set, we build the geometry by hand with
//          per-segment radius pulled from neighbour spacing.
// 2D mode: drei <Line> at constant screen-space thickness.
// Playback: when `progress` is between 0 and 1, only the leading prefix of
//          points is reconstructed, and a Sparkler rides the leading point.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { Line } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import {
  type PaintStrokeStyle,
  distanceBetween,
  thicknessForSegment,
  unpackPoints,
} from '@/lib/forge/paint-stroke'
import { Sparkler } from './Sparkler'

interface PaintStrokeMeshProps extends PaintStrokeStyle {
  /** Flat [x,y,z, x,y,z, ...]. */
  points: number[]
  /** Optional 0..1 prefix-of-points to reveal — used by playback. Undefined = full stroke. */
  progress?: number
  /** When playback is active, render a Sparkler at the leading point. */
  showLeadingSparkler?: boolean
  /** Sparkler tint when leading sparkler is shown. */
  leadingSparklerColor?: string
}

const TUBE_RADIAL_SEGMENTS = 6
const VARIABLE_RADIAL_SEGMENTS = 6

export function PaintStrokeMesh({
  points,
  color,
  thickness,
  shininess,
  mode,
  varyByVelocity,
  progress,
  showLeadingSparkler,
  leadingSparklerColor,
}: PaintStrokeMeshProps) {
  // Live in-progress strokes mutate `points` in place (Array.push) so the
  // outer reference is stable across appends. Including `points.length` in
  // the dep list ensures the geometry rebuilds each time a sample is added —
  // without it, the live tube would only appear on stroke_ended.
  const allPoints = useMemo(() => unpackPoints(points), [points, points.length])

  // Compute the visible prefix from progress.
  const visiblePoints = useMemo(() => {
    if (progress === undefined || progress >= 1) return allPoints
    if (progress <= 0) return []
    const exact = progress * (allPoints.length - 1)
    const head = Math.max(2, Math.floor(exact) + 1)
    const visible = allPoints.slice(0, Math.min(head, allPoints.length))
    // Interpolate the leading point to a fractional position for smoothness.
    const frac = exact - Math.floor(exact)
    if (frac > 0 && head < allPoints.length) {
      const a = allPoints[head - 1]
      const b = allPoints[head]
      visible[visible.length - 1] = [
        a[0] + (b[0] - a[0]) * frac,
        a[1] + (b[1] - a[1]) * frac,
        a[2] + (b[2] - a[2]) * frac,
      ]
    }
    return visible
  }, [allPoints, progress])

  const leadingPoint = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1] : null

  // Build the 3D mode geometry.
  const tubeGeometry = useMemo(() => {
    if (mode !== '3d' || visiblePoints.length < 2) return null
    if (varyByVelocity) return buildVariableTube(visiblePoints, thickness)
    return buildUniformTube(visiblePoints, thickness)
  }, [mode, visiblePoints, thickness, varyByVelocity])

  // Dispose tube geometry when it changes / unmounts.
  useEffect(() => {
    return () => { tubeGeometry?.dispose() }
  }, [tubeGeometry])

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: clamp01(shininess) * 0.85,
      roughness: 1 - clamp01(shininess) * 0.85,
      emissive: color,
      emissiveIntensity: clamp01(shininess) * 0.25,
    })
  }, [color, shininess])

  useEffect(() => {
    return () => { material.dispose() }
  }, [material])

  // Empty stroke (e.g. progress=0): render only the sparkler if asked.
  if (mode === '3d') {
    return (
      <>
        {tubeGeometry && <mesh geometry={tubeGeometry} material={material} />}
        {showLeadingSparkler && leadingPoint && (
          <Sparkler position={leadingPoint} color={leadingSparklerColor || color} active />
        )}
      </>
    )
  }

  // 2D mode — screen-space thickness via drei Line.
  if (visiblePoints.length < 2) {
    if (showLeadingSparkler && leadingPoint) {
      return <Sparkler position={leadingPoint} color={leadingSparklerColor || color} active />
    }
    return null
  }
  return (
    <>
      <Line
        points={visiblePoints as Array<[number, number, number]>}
        color={color}
        lineWidth={Math.max(1, thickness * 80)}
        transparent
        opacity={0.95}
      />
      {showLeadingSparkler && leadingPoint && (
        <Sparkler position={leadingPoint} color={leadingSparklerColor || color} active />
      )}
    </>
  )
}

function buildUniformTube(points: Array<[number, number, number]>, thickness: number): THREE.BufferGeometry {
  const vectors = points.map(p => new THREE.Vector3(p[0], p[1], p[2]))
  const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.4)
  const tubularSegments = Math.min(220, Math.max(8, vectors.length * 4))
  return new THREE.TubeGeometry(curve, tubularSegments, Math.max(0.005, thickness * 0.5), TUBE_RADIAL_SEGMENTS, false)
}

/**
 * Build a tube where each ring's radius depends on local point spacing.
 * We sample along the curve's arc-length and inverse-map back to point spacing
 * so transitions stay smooth even though raw point spacing is jagged.
 */
function buildVariableTube(points: Array<[number, number, number]>, baseThickness: number): THREE.BufferGeometry {
  const vectors = points.map(p => new THREE.Vector3(p[0], p[1], p[2]))
  const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.4)

  // Per-point radius from local segment length (look-ahead).
  const radii: number[] = new Array(vectors.length)
  for (let i = 0; i < vectors.length; i += 1) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(points.length - 1, i + 1)]
    const segLen = distanceBetween(a, b)
    radii[i] = Math.max(0.005, thicknessForSegment(baseThickness, segLen, true) * 0.5)
  }

  const tubularSegments = Math.min(220, Math.max(8, vectors.length * 4))
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const frames = curve.computeFrenetFrames(tubularSegments, false)

  for (let s = 0; s <= tubularSegments; s += 1) {
    const t = s / tubularSegments
    const center = curve.getPointAt(t)
    const N = frames.normals[s]
    const B = frames.binormals[s]
    // Radius interpolated from per-point radii.
    const fIdx = t * (vectors.length - 1)
    const i0 = Math.floor(fIdx)
    const i1 = Math.min(vectors.length - 1, i0 + 1)
    const lerp = fIdx - i0
    const radius = radii[i0] * (1 - lerp) + radii[i1] * lerp
    for (let r = 0; r <= VARIABLE_RADIAL_SEGMENTS; r += 1) {
      const v = (r / VARIABLE_RADIAL_SEGMENTS) * Math.PI * 2
      const sx = Math.cos(v)
      const sy = Math.sin(v)
      const nx = N.x * sx + B.x * sy
      const ny = N.y * sx + B.y * sy
      const nz = N.z * sx + B.z * sy
      positions.push(center.x + nx * radius, center.y + ny * radius, center.z + nz * radius)
      normals.push(nx, ny, nz)
    }
  }

  for (let s = 0; s < tubularSegments; s += 1) {
    for (let r = 0; r < VARIABLE_RADIAL_SEGMENTS; r += 1) {
      const a = s * (VARIABLE_RADIAL_SEGMENTS + 1) + r
      const b = (s + 1) * (VARIABLE_RADIAL_SEGMENTS + 1) + r
      const c = (s + 1) * (VARIABLE_RADIAL_SEGMENTS + 1) + r + 1
      const d = s * (VARIABLE_RADIAL_SEGMENTS + 1) + r + 1
      // CCW winding so outward-facing normals match THREE.js FrontSide default.
      indices.push(a, d, b, b, d, c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setIndex(indices)
  return geo
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
