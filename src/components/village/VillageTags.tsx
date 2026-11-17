'use client'

// ░▒▓ VILLAGE TAGS — the name over each agent's head, and a quest marker when it wants the owner ▓▒░
// In the 3D picture, not HTML. The name has four styles (Settings > Agents, lib/village/tag-style.ts) and a size:
//   outlined  flat letters with a true outline: troika text (SDF), crisp at any distance.
//   layered   the first look: flat letters, a darker copy stepped behind, a black copy around.
//   3D        real solid letters (three TextGeometry, bevelled), one merged mesh per name, built once and cached.
//   crazy     solid calligraphic letters on a wave, shading through the hues of the agent. Also one mesh.
// The status word under it is flat, outlined. The name turns to the camera; the solid styles turn on the vertical
// axis only (they stay upright) and sway a little, so their depth shows even when you stand square to them.
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
import { TAG, shadeColor, tagScale, tagText, type TagMarker } from '../../lib/village/village-tags'
import { getTagSettings, getTagSettingsVersion, subscribeTagSettings, type TagStyle } from '../../lib/village/tag-style'
import { measureVillageBody } from './village-companion'

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const FONT_FILES = {
  regular: `${BASE}/fonts/helvetiker_regular.typeface.json`,
  bold: `${BASE}/fonts/helvetiker_bold.typeface.json`,
  crazy: `${BASE}/fonts/gentilis_bold.typeface.json`,
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
 * Solid letters: the front in `color`, the sides and bevel darker. `crazy` puts the baseline on a wave and
 * shades the hue along the word. Centred on x and z so it turns about its own middle.
 */
function solidGeometry(loaded: Font, text: string, size: number, color: string, crazy: boolean): THREE.BufferGeometry {
  const key = `S${crazy ? 'c' : 'x'}\u0001${text}\u0001${size}\u0001${color}`
  const cached = textCache.get(key)
  if (cached) return cached
  const depth = size * (crazy ? 0.42 : 0.34)
  const geometry = new TextGeometry(text, {
    font: loaded, size, height: depth, curveSegments: crazy ? 4 : 3,
    bevelEnabled: true, bevelThickness: size * 0.035, bevelSize: size * 0.025, bevelOffset: 0, bevelSegments: 1,
  })
  const position = geometry.attributes.position
  if (crazy) {
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, position.getY(i) + Math.sin(position.getX(i) / size * 2.4) * size * 0.16)
    }
  }
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  const width = Math.max(1e-6, box.max.x - box.min.x)
  geometry.translate(-(box.min.x + box.max.x) / 2, 0, -depth / 2)
  const base = { h: 0, s: 0, l: 0 }
  _color.set(color).getHSL(base)
  const colors = new Float32Array(position.count * 3)
  // Group 0 is the front and back faces, group 1 the sides (and the bevel): the sides are darker.
  const sideOf = new Uint8Array(position.count)
  for (const group of geometry.groups) {
    if (group.materialIndex === 1) sideOf.fill(1, group.start, group.start + group.count)
  }
  for (let i = 0; i < position.count; i += 1) {
    const along = (position.getX(i) + width / 2) / width
    const hue = crazy ? (base.h + (along - 0.5) * 0.5 + 1) % 1 : base.h
    _color.setHSL(hue, base.s, sideOf[i] ? base.l * 0.42 : base.l)
    colors[i * 3] = _color.r
    colors[i * 3 + 1] = _color.g
    colors[i * 3 + 2] = _color.b
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
  if (style === 'extruded' && fonts.bold) vertices = solidGeometry(fonts.bold, text, size, '#ffffff', false).attributes.position.count
  else if (style === 'crazy' && fonts.crazy) vertices = solidGeometry(fonts.crazy, text, size * 1.1, '#ffffff', true).attributes.position.count
  else if (style === 'layered' && fonts.regular) vertices = layeredGeometry(fonts.regular, text, size, '#ffffff', true).attributes.position.count
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
    const solid = style === 'extruded' || style === 'crazy'
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
          tag.measured = body.rigged || tag.tries > 20
          root.position.y = body.top
        }
      }
      root.getWorldPosition(_world)
      const scale = tagScale(_world.distanceTo(camera.position)) * size
      if (tag.board.scale.x !== scale) tag.board.scale.setScalar(scale)
      root.getWorldQuaternion(_rootQuat)
      if (solid) {
        // Upright: only turned about the vertical axis, towards the camera, with a sway that shows the depth.
        const yaw = Math.atan2(camera.position.x - _world.x, camera.position.z - _world.z) + Math.sin(t * 0.9 + tag.phase) * (style === 'crazy' ? 0.5 : 0.36)
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

export function VillageTag({ agentId, name, color, rim, status, statusColor, marker, avatarKey, x, z }: {
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
  const regular = useFont(style === 'outline' ? null : 'regular')
  const bold = useFont(style === 'extruded' || marker ? 'bold' : null)
  const crazy = useFont(style === 'crazy' ? 'crazy' : null)
  const root = useRef<THREE.Group>(null)
  const board = useRef<THREE.Group>(null)
  const holder = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)
  const entry = useRef<TagEntry | null>(null)

  const plainName = tagText(name)
  const plainStatus = tagText(status, 34)
  const nameGeometry = useMemo(() => {
    if (!plainName) return null
    if (style === 'layered' && regular) return layeredGeometry(regular, plainName, TAG.nameSize, color, true)
    if (style === 'extruded' && bold) return solidGeometry(bold, plainName, TAG.nameSize, color, false)
    if (style === 'crazy' && crazy) return solidGeometry(crazy, plainName, TAG.nameSize * 1.1, color, true)
    return null
  }, [style, regular, bold, crazy, plainName, color])
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
              <Text font={TROIKA_FONT} fontSize={TAG.statusSize * 1.05} color={statusColor} outlineWidth="14%" outlineColor="#000000" anchorX="center" anchorY="bottom" position={[0, TAG.statusAt, 0]} raycast={NO_RAYCAST} material-toneMapped={false}>
                {plainStatus}
              </Text>
            )}
            {plainName && (
              <Text font={TROIKA_FONT} fontSize={TAG.nameSize * 1.05} color={color} outlineWidth="12%" outlineColor="#000000" anchorX="center" anchorY="bottom" position={[0, TAG.nameAt, 0]} raycast={NO_RAYCAST} material-toneMapped={false}>
                {plainName}
              </Text>
            )}
          </>
        ) : (
          <>
            {statusGeometry && <mesh geometry={statusGeometry} material={tagMaterial} position={[0, TAG.statusAt, 0]} raycast={NO_RAYCAST} />}
            {nameGeometry && <mesh geometry={nameGeometry} material={tagMaterial} position={[0, TAG.nameAt, 0]} raycast={NO_RAYCAST} />}
          </>
        )}
      </group>
      <group ref={holder} position={[0, TAG.markerAt, 0]}>
        {markerGeo && (
          <group ref={spinRef}>
            <mesh geometry={markerGeo} material={markerMaterialFor(statusColor)} raycast={NO_RAYCAST} />
            <mesh geometry={markerGeo} material={rimMaterialFor(rim)} scale={1.17} raycast={NO_RAYCAST} />
          </group>
        )}
      </group>
    </group>
  )
}
