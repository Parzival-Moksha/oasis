'use client'

// ░▒▓ VILLAGE TAGS — the name over each agent's head, and a quest marker when it wants the owner ▓▒░
// In the 3D picture, not HTML. The name has two styles (Settings > Agents, lib/village/tag-style.ts) and a size:
//   3D        real solid letters (three TextGeometry, bevelled), their sides 2.6 times darker than their faces;
//             one merged mesh per name, built once and cached. The default.
//   outlined  flat letters with a true outline: troika text (SDF), crisp at any distance.
// (Layered and crazy were taken out on 2026-11-19, and so was the sway of the 3D names: the owner found it annoying.)
// The status word under it is flat, outlined. The name turns to the camera; 3D names turn on the vertical axis only,
// so they stay upright.
// The marker, a 3D "!" or "?" with a rim in the agent's colour, is NOT turned to the camera: upright, it turns
// slowly on its own vertical axis and breathes.
// Cost: one or two draw calls per agent for the name, one for the status word, two for a marker (body and rim);
// no per-agent frame callbacks: one loop (VillageTagDriver) moves every tag.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { SIDE_DARKER, TAG, divideColor, shadeColor, tagScale, tagText, type TagMarker } from '../../lib/village/village-tags'
import { getTagSettings, getTagSettingsVersion, subscribeTagSettings, type TagStyle } from '../../lib/village/tag-style'
import { measureVillageBody } from './village-companion'

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const FONT_FILES = {
  regular: `${BASE}/fonts/helvetiker_regular.typeface.json`,
  bold: `${BASE}/fonts/helvetiker_bold.typeface.json`,
} as const
/** The flat outlined style's font (an open-licence Inter Bold, served from here: nothing is fetched from a CDN). */
const TROIKA_FONT = `${BASE}/fonts/inter-latin-700.woff`
type FontKind = keyof typeof FONT_FILES

// ─── the fonts, loaded once each ────────────────────────────────────────────

const fonts: Partial<Record<FontKind, Font>> = {}
const fontPromises: Partial<Record<FontKind, Promise<Font | null>>> = {}

function loadFont(kind: FontKind): Promise<Font | null> {
  let promise = fontPromises[kind]
  if (!promise) {
    promise = new Promise(resolve => {
      new FontLoader().load(FONT_FILES[kind], loaded => { fonts[kind] = loaded; resolve(loaded) }, undefined, () => {
        console.warn(`[village] the tag font "${kind}" did not load`)
        resolve(null)
      })
    })
    fontPromises[kind] = promise
  }
  return promise
}

function useFont(kind: FontKind | null): Font | null {
  const [ready, setReady] = useState<Font | null>(kind ? fonts[kind] ?? null : null)
  useEffect(() => {
    if (!kind) { setReady(null); return }
    let alive = true
    void loadFont(kind).then(loaded => { if (alive) setReady(loaded) })
    return () => { alive = false }
  }, [kind])
  return kind ? fonts[kind] ?? ready : null
}

// ─── geometry: one mesh per piece of text, colours on the vertices ───────────

/** Every tag shares this material: the colours are per vertex, nothing is lit (readable at night). */
const tagMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
const textCache = new Map<string, THREE.BufferGeometry>()
const TEXT_CACHE_MAX = 200
const _color = new THREE.Color()

function remember(key: string, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  textCache.set(key, geometry)
  // Names are few; an old one leaves when the cache is full.
  if (textCache.size > TEXT_CACHE_MAX) {
    const oldest = textCache.keys().next().value as string
    textCache.get(oldest)?.dispose()
    textCache.delete(oldest)
  }
  return geometry
}

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
  flat.clearGroups()
  return flat
}

/** The flat, layered style (and the status word): letters, a darker copy stepped behind when `extruded`, a black copy around. */
function layeredGeometry(loaded: Font, text: string, size: number, color: string, extruded: boolean): THREE.BufferGeometry {
  const key = `L\u0001${text}\u0001${size}\u0001${color}\u0001${extruded ? 1 : 0}`
  const cached = textCache.get(key)
  if (cached) return cached
  const flat = { font: loaded, size, height: 0.002, curveSegments: 3, bevelEnabled: false } as const
  const side = { ...flat, curveSegments: 1 } as const
  const depth = size * 0.16
  const parts: THREE.BufferGeometry[] = [paint(new TextGeometry(text, flat), color)]
  if (extruded) {
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
  return remember(key, merged)
}

/**
 * Solid letters: the faces in `color`, the sides and bevel 2.6 times darker (each colour channel as you would
 * read it in a colour picker, divided by 2.6), so the depth reads at a glance. Centred on x and z.
 */
function solidGeometry(loaded: Font, text: string, size: number, color: string): THREE.BufferGeometry {
  const key = `S\u0001${text}\u0001${size}\u0001${color}`
  const cached = textCache.get(key)
  if (cached) return cached
  const depth = size * 0.34
  const geometry = new TextGeometry(text, {
    font: loaded, size, height: depth, curveSegments: 3,
    bevelEnabled: true, bevelThickness: size * 0.035, bevelSize: size * 0.025, bevelOffset: 0, bevelSegments: 1,
  })
  const position = geometry.attributes.position
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  geometry.translate(-(box.min.x + box.max.x) / 2, 0, -depth / 2)
  const face = new THREE.Color(color)
  const side = new THREE.Color(divideColor(color, SIDE_DARKER))
  const colors = new Float32Array(position.count * 3)
  // Group 0 is the front and back faces, group 1 the sides (and the bevel).
  const sideOf = new Uint8Array(position.count)
  for (const group of geometry.groups) {
    if (group.materialIndex === 1) sideOf.fill(1, group.start, group.start + group.count)
  }
  for (let i = 0; i < position.count; i += 1) {
    const c = sideOf[i] ? side : face
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.deleteAttribute('uv')
  geometry.deleteAttribute('normal')
  geometry.clearGroups()
  geometry.computeBoundingSphere()
  return remember(key, geometry)
}

/** Triangle count of the geometry for a name in a style (for the cost numbers in the notes). */
export function tagTriangleCount(style: TagStyle, text: string): number {
  const size = TAG.nameSize
  let vertices = 0
  if (style === 'extruded' && fonts.bold) vertices = solidGeometry(fonts.bold, text, size, '#ffffff').attributes.position.count
  return Math.round(vertices / 3)
}

// The markers: one extruded glyph each, shared by every agent; a body material per status colour, a rim per agent colour.
const markerGeometry = new Map<TagMarker, THREE.BufferGeometry>()
const markerMaterial = new Map<string, THREE.MeshStandardMaterial>()
const rimMaterial = new Map<string, THREE.MeshBasicMaterial>()

function markerGeometryFor(loaded: Font, glyph: TagMarker): THREE.BufferGeometry {
  let geometry = markerGeometry.get(glyph)
  if (!geometry) {
    geometry = new TextGeometry(glyph, { font: loaded, size: TAG.markerSize, height: TAG.markerSize * 0.2, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 2 })
    geometry.center()
    markerGeometry.set(glyph, geometry)
  }
  return geometry
}

function markerMaterialFor(color: string): THREE.MeshStandardMaterial {
  let material = markerMaterial.get(color)
  if (!material) {
    // Its own light: readable at night, and it glows through the bloom.
    material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.25, toneMapped: false })
    markerMaterial.set(color, material)
  }
  return material
}

/** The rim: the same glyph a little larger, drawn from the inside only, so it shows as an outline in the agent's colour. */
function rimMaterialFor(color: string): THREE.MeshBasicMaterial {
  let material = rimMaterial.get(color)
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false })
    rimMaterial.set(color, material)
  }
  return material
}

// ─── the one loop ───────────────────────────────────────────────────────────

interface TagEntry {
  agentId: string
  /** At the top of the body, in the agent's group; never turned. */
  root: THREE.Group
  /** The name and the status word: turned to the camera, scaled. */
  board: THREE.Group
  /** Carries the marker up above the name, scaled with it. */
  holder: THREE.Group
  /** The marker itself: turns on its own vertical axis. */
  spin: THREE.Object3D | null
  top: number
  measured: boolean
  tries: number
  nextMeasureAt: number
  phase: number
}

// ─── the T / E / F keys over the agent the owner is near (the bottom banner's three keys, in the world) ─────

const KEYS = [
  { key: 'T', word: 'talk', accent: '#34d399' },
  { key: 'E', word: 'write', accent: '#38bdf8' },
  { key: 'F', word: 'full', accent: '#c084fc' },
] as const
let keysGeometry: THREE.BufferGeometry | null = null

/** The row of three keycaps with their words, centred on x, its bottom at y = 0: one geometry, colours on the vertices. */
function keysRowGeometry(bold: Font, regular: Font): THREE.BufferGeometry {
  if (keysGeometry) return keysGeometry
  const cap = 0.2
  const parts: THREE.BufferGeometry[] = []
  const blocks: Array<{ width: number; build: (x: number) => void }> = KEYS.map(item => {
    const word = layeredGeometry(regular, item.word, 0.075, '#f1f5f9', false).clone()
    word.computeBoundingBox()
    const wordBox = word.boundingBox as THREE.Box3
    const wordWidth = wordBox.max.x - wordBox.min.x
    return {
      width: cap + 0.05 + wordWidth,
      build: (x: number) => {
        const mid = x + cap / 2
        // An accent plate behind the cap (its rim), the dark cap, the letter on it in the accent colour.
        parts.push(paint(new THREE.BoxGeometry(cap + 0.03, cap + 0.03, 0.02).translate(mid, cap / 2, -0.035), item.accent))
        parts.push(paint(new RoundedBoxGeometry(cap, cap, 0.06, 2, 0.03).translate(mid, cap / 2, 0), '#0f172a'))
        const letter = new TextGeometry(item.key, { font: bold, size: 0.12, height: 0.02, curveSegments: 3, bevelEnabled: false })
        letter.computeBoundingBox()
        const lb = letter.boundingBox as THREE.Box3
        letter.translate(mid - (lb.min.x + lb.max.x) / 2, cap / 2 - (lb.min.y + lb.max.y) / 2, 0.032)
        parts.push(paint(letter, item.accent))
        parts.push(word.translate(x + cap + 0.05 - wordBox.min.x, cap / 2 - 0.035, 0))
      },
    }
  })
  const gap = 0.12
  const total = blocks.reduce((sum, block) => sum + block.width, 0) + gap * (blocks.length - 1)
  let x = -total / 2
  for (const block of blocks) {
    block.build(x)
    x += block.width + gap
  }
  keysGeometry = mergeGeometries(parts, false) as THREE.BufferGeometry
  parts.forEach(part => part.dispose())
  keysGeometry.computeBoundingSphere()
  return keysGeometry
}

// ─── how high each tag reaches (the desk screen keeps clear of it) ──────────────────────────────────

const tops = new Map<string, number>()
const topListeners = new Set<() => void>()
let topVersion = 0

function noteTop(agentId: string, top: number): void {
  const before = tops.get(agentId)
  if (before !== undefined && Math.abs(before - top) < 0.01) return
  tops.set(agentId, top)
  topVersion += 1
  topListeners.forEach(listener => listener())
}

/**
 * How high above the agent's feet its tag reaches at the chosen size, marker included (its slot is kept whether
 * or not a marker shows): the desk screen over it stays above this (VillageWorld).
 */
export function useVillageTagReach(agentId: string): number {
  useSyncExternalStore(listener => { topListeners.add(listener); return () => { topListeners.delete(listener) } }, () => topVersion, () => 0)
  useSyncExternalStore(subscribeTagSettings, getTagSettingsVersion, () => 0)
  return villageTagReach(agentId)
}

/** The same, read now (for code that runs every few frames rather than in a render). */
export function villageTagReach(agentId: string): number {
  return (tops.get(agentId) ?? TAG.defaultTop) + (TAG.markerAt + TAG.markerSize / 2) * getTagSettings().size
}

/** Where a desk screen floats over its agent (station-local), clear of everything its tag can show. */
export function deskScreenHeight(reach: number, base: number, halfHeight: number): number {
  return Math.max(base, reach + halfHeight + 0.08)
}

const tags = new Set<TagEntry>()
const _rootQuat = new THREE.Quaternion()
const _facing = new THREE.Quaternion()
const _world = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/** Mounted once with the village: every name faces the camera, far ones grow, markers turn and breathe. */
export function VillageTagDriver() {
  useFrame(({ camera, clock }) => {
    if (!tags.size) return
    const t = clock.elapsedTime
    const { style, size } = getTagSettings()
    const solid = style === 'extruded'
    for (const tag of tags) {
      const root = tag.root
      if (!root.parent) continue
      // The body may still be loading: look again twice a second until its height is known.
      if (!tag.measured && t >= tag.nextMeasureAt) {
        tag.nextMeasureAt = t + 0.5
        const body = measureVillageBody(tag.agentId)
        if (body) {
          // The stand-in shown while the body loads has no skeleton: use its height for now, and keep looking
          // (a body without any skeleton is taken as it is after ten seconds).
          tag.tries += 1
          tag.top = body.top
          noteTop(tag.agentId, body.top)
          tag.measured = body.rigged || tag.tries > 20
          root.position.y = body.top
        }
      }
      root.getWorldPosition(_world)
      const scale = tagScale(_world.distanceTo(camera.position)) * size
      if (tag.board.scale.x !== scale) tag.board.scale.setScalar(scale)
      root.getWorldQuaternion(_rootQuat)
      if (solid) {
        // Upright: only turned about the vertical axis, towards the camera (no sway: the owner found it annoying).
        const yaw = Math.atan2(camera.position.x - _world.x, camera.position.z - _world.z)
        _facing.setFromAxisAngle(_up, yaw)
        tag.board.quaternion.copy(_rootQuat).invert().multiply(_facing)
      } else {
        // The flat styles are cards: the camera's own orientation, undone by whatever turns the agent.
        tag.board.quaternion.copy(_rootQuat).invert().multiply(camera.quaternion)
      }
      if (tag.holder.scale.x !== scale) {
        tag.holder.scale.setScalar(scale)
        tag.holder.position.y = TAG.markerAt * scale
      }
      const spin = tag.spin
      if (spin) {
        // Its own vertical axis, slowly, whatever the camera does; and it breathes.
        spin.rotation.y = t * 0.9 + tag.phase
        spin.scale.setScalar(1 + Math.sin(t * 2.2 + tag.phase) * 0.07)
      }
    }
  })
  return null
}

// ─── one agent's tag ────────────────────────────────────────────────────────

const NO_RAYCAST = () => {}

export function VillageTag({ agentId, name, color, rim, status, statusColor, marker, avatarKey, x, z, keys = false }: {
  /** The owner is near it (its T / E / F work): the keys show over its head. */
  keys?: boolean
  agentId: string
  name: string
  /** The agent's colour, lightened to read on any background (village-tags.ts readableAccent). */
  color: string
  /** The agent's own colour as picked: the marker's rim. */
  rim: string
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
  useSyncExternalStore(subscribeTagSettings, getTagSettingsVersion, () => 0)
  const { style } = getTagSettings()
  const regular = useFont(style === 'outline' && !keys ? null : 'regular')
  const bold = useFont(style === 'extruded' || marker || keys ? 'bold' : null)
  const root = useRef<THREE.Group>(null)
  const board = useRef<THREE.Group>(null)
  const holder = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)
  const entry = useRef<TagEntry | null>(null)

  const plainName = tagText(name)
  const plainStatus = tagText(status, 34)
  const nameGeometry = useMemo(() => {
    if (!plainName) return null
    if (style === 'extruded' && bold) return solidGeometry(bold, plainName, TAG.nameSize, color)
    return null
  }, [style, bold, plainName, color])
  const statusGeometry = useMemo(
    () => (style !== 'outline' && regular && plainStatus ? layeredGeometry(regular, plainStatus, TAG.statusSize, statusColor, false) : null),
    [style, regular, plainStatus, statusColor],
  )

  useEffect(() => {
    if (!root.current || !board.current || !holder.current) return
    let sum = 0
    for (let i = 0; i < agentId.length; i += 1) sum += agentId.charCodeAt(i)
    root.current.position.y = TAG.defaultTop
    const tag: TagEntry = { agentId, root: root.current, board: board.current, holder: holder.current, spin: null, top: TAG.defaultTop, measured: false, tries: 0, nextMeasureAt: 0, phase: (sum % 63) / 10 }
    entry.current = tag
    tags.add(tag)
    return () => {
      tags.delete(tag)
      entry.current = null
    }
  }, [agentId])

  // Another body: measure its height again.
  useEffect(() => {
    if (entry.current) {
      entry.current.measured = false
      entry.current.tries = 0
    }
  }, [avatarKey])

  // The marker comes and goes with the status.
  useEffect(() => {
    if (entry.current) entry.current.spin = spinRef.current
  }, [marker, bold])

  const markerGeo = marker && bold ? markerGeometryFor(bold, marker) : null
  return (
    <group ref={root} position-x={x} position-z={z} name="village-tag">
      <group ref={board}>
        {style === 'outline' ? (
          <>
            {plainStatus && (
              <Text name="village-tag-status" font={TROIKA_FONT} fontSize={TAG.statusSize * 1.05} color={statusColor} outlineWidth="14%" outlineColor="#000000" anchorX="center" anchorY="bottom" position={[0, TAG.statusAt, 0]} raycast={NO_RAYCAST} material-toneMapped={false}>
                {plainStatus}
              </Text>
            )}
            {plainName && (
              <Text name="village-tag-name" font={TROIKA_FONT} fontSize={TAG.nameSize * 1.05} color={color} outlineWidth="12%" outlineColor="#000000" anchorX="center" anchorY="bottom" position={[0, TAG.nameAt, 0]} raycast={NO_RAYCAST} material-toneMapped={false}>
                {plainName}
              </Text>
            )}
          </>
        ) : (
          <>
            {statusGeometry && <mesh name="village-tag-status" geometry={statusGeometry} material={tagMaterial} position={[0, TAG.statusAt, 0]} raycast={NO_RAYCAST} />}
            {nameGeometry && <mesh name="village-tag-name" geometry={nameGeometry} material={tagMaterial} position={[0, TAG.nameAt, 0]} raycast={NO_RAYCAST} />}
          </>
        )}
        {/* T / E / F, just over its head, in the slot kept for them under the status word. */}
        {keys && bold && regular && (
          <mesh name="village-keys" geometry={keysRowGeometry(bold, regular)} material={tagMaterial} position={[0, TAG.keysAt, 0]} raycast={NO_RAYCAST} />
        )}
      </group>
      <group ref={holder} position={[0, TAG.markerAt, 0]}>
        {markerGeo && (
          <group ref={spinRef} name="village-tag-marker">
            <mesh geometry={markerGeo} material={markerMaterialFor(statusColor)} raycast={NO_RAYCAST} />
            <mesh geometry={markerGeo} material={rimMaterialFor(rim)} scale={1.17} raycast={NO_RAYCAST} />
          </group>
        )}
      </group>
    </group>
  )
}
