'use client'

// ░▒▓ VILLAGE TAGS — the name over each agent's head, and a quest marker when it wants the owner ▓▒░
// In the 3D picture, not HTML: real text geometry from the repo's font (public/fonts), so it sits in the
// world, is lit by nothing (always readable) and takes part in the picture's depth.
//   The name   in the agent's own colour, a darker copy offset behind it (the extruded look, visible from any
//              side because the tag always faces the camera), and a black outline around both. One mesh.
//   The status the word under the name, in the status colour, with the same outline. One mesh.
//   The marker a 3D "!" (it has something to tell you: finished, stuck) or "?" (it asks a decision), in the
//              status colour, slowly turning from side to side and breathing: an MMO quest marker. One shared geometry per glyph.
// It stands just above the avatar's own head: the body's height is measured from its skeleton and meshes
// (village-companion.ts measureVillageBody), so a tall unicorn's and a short girl's sit where they should.
// Cost: two or three draw calls per agent, no per-agent frame callbacks: one loop (VillageTagDriver) turns every
// tag to the camera, scales the far ones up, and spins the markers.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TAG, shadeColor, tagScale, tagText, type TagMarker } from '../../lib/village/village-tags'
import { measureVillageBody } from './village-companion'

const FONT_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/fonts/helvetiker_regular.typeface.json`

// ─── the font, loaded once ──────────────────────────────────────────────────

let font: Font | null = null
let fontPromise: Promise<Font | null> | null = null

function loadFont(): Promise<Font | null> {
  if (!fontPromise) {
    fontPromise = new Promise(resolve => {
      new FontLoader().load(FONT_URL, loaded => { font = loaded; resolve(loaded) }, undefined, () => {
        console.warn('[village] the tag font did not load: agents have no name tags')
        resolve(null)
      })
    })
  }
  return fontPromise
}

function useTagFont(): Font | null {
  const [ready, setReady] = useState<Font | null>(font)
  useEffect(() => {
    let alive = true
    void loadFont().then(loaded => { if (alive) setReady(loaded) })
    return () => { alive = false }
  }, [])
  return ready
}

// ─── geometry: one mesh per piece of text, colours on the vertices ───────────

/** Every tag shares this material: the colours are per vertex, nothing is lit. */
const tagMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
const textCache = new Map<string, THREE.BufferGeometry>()
const TEXT_CACHE_MAX = 160
const _color = new THREE.Color()

function paint(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  if (flat !== geometry) geometry.dispose()
  const count = flat.attributes.position.count
  const colors = new Float32Array(count * 3)
  _color.set(hex)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = _color.r
    colors[i * 3 + 1] = _color.g
    colors[i * 3 + 2] = _color.b
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  flat.deleteAttribute('uv')
  flat.deleteAttribute('normal')
  return flat
}

/**
 * Text as one geometry, centred on x, its baseline at y = 0: the letters in `color`, a darker copy offset behind
 * them when `extruded` (the 3D look), and a black copy grown by a bevel behind both (the outline).
 */
function textGeometry(loaded: Font, text: string, size: number, color: string, extruded: boolean): THREE.BufferGeometry {
  const key = `${text}\u0001${size}\u0001${color}\u0001${extruded ? 1 : 0}`
  const cached = textCache.get(key)
  if (cached) return cached
  const flat = { font: loaded, size, height: 0.002, curveSegments: 3, bevelEnabled: false } as const
  const side = { ...flat, curveSegments: 1 } as const
  const depth = size * 0.16
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(new TextGeometry(text, flat), color))
  if (extruded) {
    // The side of the extrusion: the same letters, darker, stepped back and down in three layers.
    for (let layer = 1; layer <= 3; layer += 1) {
      const step = (depth * layer) / 3
      parts.push(paint(new TextGeometry(text, side).translate(step * 0.55, -step * 0.55, -step), shadeColor(color)))
    }
  }
  const outline = new TextGeometry(text, { font: loaded, size, height: 0.002, curveSegments: 2, bevelEnabled: true, bevelThickness: 0.001, bevelSize: size * 0.085, bevelSegments: 1 })
  parts.push(paint(outline.translate(extruded ? depth * 0.3 : 0, extruded ? -depth * 0.3 : 0, -(extruded ? depth : 0) - 0.012), '#000000'))
  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry
  parts.forEach(part => part.dispose())
  merged.computeBoundingBox()
  const box = merged.boundingBox as THREE.Box3
  merged.translate(-(box.min.x + box.max.x) / 2, 0, 0)
  merged.computeBoundingSphere()
  textCache.set(key, merged)
  // Names and status words are few; an old one leaves when the cache is full.
  if (textCache.size > TEXT_CACHE_MAX) {
    const oldest = textCache.keys().next().value as string
    textCache.get(oldest)?.dispose()
    textCache.delete(oldest)
  }
  return merged
}

// The markers: one extruded glyph each, shared by every agent; a material per status colour.
const markerGeometry = new Map<TagMarker, THREE.BufferGeometry>()
const markerMaterial = new Map<string, THREE.MeshStandardMaterial>()

function markerGeometryFor(loaded: Font, glyph: TagMarker): THREE.BufferGeometry {
  let geometry = markerGeometry.get(glyph)
  if (!geometry) {
    geometry = new TextGeometry(glyph, { font: loaded, size: TAG.markerSize, height: TAG.markerSize * 0.28, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 })
    geometry.center()
    markerGeometry.set(glyph, geometry)
  }
  return geometry
}

function markerMaterialFor(color: string): THREE.MeshStandardMaterial {
  let material = markerMaterial.get(color)
  if (!material) {
    // Its own light: readable at night, and it glows through the bloom.
    material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.2, toneMapped: false })
    markerMaterial.set(color, material)
  }
  return material
}

// ─── the one loop ───────────────────────────────────────────────────────────

interface TagEntry {
  agentId: string
  /** Turned to the camera and scaled. */
  group: THREE.Group
  marker: THREE.Object3D | null
  /** The body's top above its feet, once measured. */
  top: number
  measured: boolean
  tries: number
  nextMeasureAt: number
  phase: number
}

const tags = new Set<TagEntry>()
const _parentQuat = new THREE.Quaternion()
const _world = new THREE.Vector3()

/** Mounted once with the village: every tag faces the camera, far ones grow, markers spin and breathe. */
export function VillageTagDriver() {
  useFrame(({ camera, clock }) => {
    if (!tags.size) return
    const t = clock.elapsedTime
    for (const tag of tags) {
      const group = tag.group
      const parent = group.parent
      if (!parent) continue
      // The body may still be loading: look again twice a second until its height is known.
      if (!tag.measured && t >= tag.nextMeasureAt) {
        tag.nextMeasureAt = t + 0.5
        const body = measureVillageBody(tag.agentId)
        if (body) {
          // The stand-in shown while the body loads has no skeleton: use its height for now, and keep looking
          // (a body without any skeleton is taken as it is after ten seconds).
          tag.tries += 1
          tag.top = body.top
          tag.measured = body.rigged || tag.tries > 20
          group.position.y = body.top
        }
      }
      // Face the camera: the camera's own orientation, undone by whatever turns the agent.
      parent.getWorldQuaternion(_parentQuat)
      group.quaternion.copy(_parentQuat).invert().multiply(camera.quaternion)
      group.getWorldPosition(_world)
      const scale = tagScale(_world.distanceTo(camera.position))
      if (group.scale.x !== scale) group.scale.setScalar(scale)
      const marker = tag.marker
      if (marker) {
        // Turns slowly from side to side (never edge-on to the owner: it must stay readable) and breathes.
        marker.rotation.y = Math.sin(t * 1.1 + tag.phase) * 0.7
        const pulse = 1 + Math.sin(t * 2.4 + tag.phase) * 0.09
        marker.scale.setScalar(pulse)
      }
    }
  })
  return null
}

// ─── one agent's tag ────────────────────────────────────────────────────────

export function VillageTag({ agentId, name, color, status, statusColor, marker, avatarKey, x, z }: {
  agentId: string
  name: string
  /** The agent's own colour (village-tags.ts agentTagColor). */
  color: string
  /** The status word ("working", "waiting for you"…), or empty. */
  status: string
  statusColor: string
  marker: TagMarker | null
  /** Changes when the agent wears another body: its height is measured again. */
  avatarKey: string
  /** Where the avatar stands in its station (the tag is a child of the group that moves with it). */
  x: number
  z: number
}) {
  const loaded = useTagFont()
  const group = useRef<THREE.Group>(null)
  const markerRef = useRef<THREE.Mesh>(null)
  const entry = useRef<TagEntry | null>(null)

  const nameGeometry = useMemo(() => (loaded && name ? textGeometry(loaded, tagText(name), TAG.nameSize, color, true) : null), [loaded, name, color])
  const statusGeometry = useMemo(() => (loaded && status ? textGeometry(loaded, tagText(status, 34), TAG.statusSize, statusColor, false) : null), [loaded, status, statusColor])

  useEffect(() => {
    if (!group.current) return
    let sum = 0
    for (let i = 0; i < agentId.length; i += 1) sum += agentId.charCodeAt(i)
    const tag: TagEntry = { agentId, group: group.current, marker: markerRef.current, top: TAG.defaultTop, measured: false, tries: 0, nextMeasureAt: 0, phase: (sum % 63) / 10 }
    group.current.position.y = tag.top
    entry.current = tag
    tags.add(tag)
    return () => {
      tags.delete(tag)
      entry.current = null
    }
  }, [agentId, loaded])

  // Another body: measure its height again.
  useEffect(() => {
    if (entry.current) {
      entry.current.measured = false
      entry.current.tries = 0
    }
  }, [avatarKey])

  // The marker comes and goes with the status.
  useEffect(() => {
    if (entry.current) entry.current.marker = markerRef.current
  }, [marker, loaded])

  if (!loaded) return null
  return (
    <group ref={group} position-x={x} position-z={z} name="village-tag">
      {statusGeometry && <mesh geometry={statusGeometry} material={tagMaterial} position={[0, TAG.statusAt, 0]} raycast={NO_RAYCAST} />}
      {nameGeometry && <mesh geometry={nameGeometry} material={tagMaterial} position={[0, TAG.nameAt, 0]} raycast={NO_RAYCAST} />}
      {marker && (
        <mesh ref={markerRef} geometry={markerGeometryFor(loaded, marker)} material={markerMaterialFor(statusColor)} position={[0, TAG.markerAt, 0]} raycast={NO_RAYCAST} />
      )}
    </group>
  )
}

const NO_RAYCAST = () => {}
