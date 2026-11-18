'use client'

// ░▒▓ VILLAGE MISSION WALL — every mission as a framed panel behind Anorak's desk ▓▒░
// Mounted inside the village's R3F layer. The FPS mission found the Oasis main-thread bound (every
// object and every draw call adds up), so the whole wall is four draw calls, whatever its size:
//   · the frames: one instanced mesh;
//   · the faces (card + TL;DR caption): one mesh, printed into one canvas texture, redrawn only when a
//     mission changes on disk;
//   · the titles, spelled out in 3D letters: one merged mesh for open missions, one for done ones.
// No drei <Html>, no SDF text objects, no useFrame, no click targets.

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useOasisStore } from '../../store/oasisStore'
import { sampleTerrainHeightAt } from '../../lib/forge/terrain-brush'
import { plazaCenter, type Vec3, type VillageOrigin, type VillageRosterAgent } from '../../lib/village/village-layout'
import {
  MISSION_COLUMN_COLOR,
  MISSION_FACE,
  MISSION_PANEL,
  layoutMissionWall,
  missionAtlasGrid,
  missionAtlasTile,
  missionPanelScale,
  missionPosterWords,
  wrapByWidth,
  type Mission,
  type MissionAtlasGrid,
  type MissionColumn,
  type MissionPanelLayout,
} from '../../lib/village/village-missions'
import type { VillageStationPlacement } from './village-actions'
import { getMissionState, setMissionPanels, subscribeMissions, type MissionPanelPlacement } from './village-mission-store'
import { WorkVowClock3D } from './WorkVowClock3D'

const TITLE_FONT = '/fonts/helvetiker_regular.typeface.json'
const TITLE_SIZE = 0.16
const TITLE_DEPTH = 0.05
const TITLE_MAX_WIDTH = 2.4
const TITLE_LINE = TITLE_SIZE * 1.45
const FRAME_COLOR = '#1b2230'
const CARD_TINT: Record<MissionColumn, string> = { doing: '#2a1c06', 'to do': '#071c2c', done: '#161b24' }
const FRAME_HEIGHT = MISSION_FACE.height + MISSION_PANEL.border * 2
const FRAME_CENTER_Y = MISSION_PANEL.bottomY + FRAME_HEIGHT / 2
const FACE_Z = MISSION_PANEL.depth / 2 + 0.004

const NO_RAYCAST = () => {}

interface WallPanel extends MissionPanelLayout {
  mission: Mission
  /** Foot of the panel, terrain included. */
  ground: Vec3
  /** Bigger for a higher priority (missionPanelScale). */
  scale: number
}

const SCALE = new THREE.Vector3()

function panelMatrix(panel: WallPanel, target = new THREE.Matrix4()): THREE.Matrix4 {
  return target.makeRotationY(panel.rotationY).scale(SCALE.setScalar(panel.scale)).setPosition(panel.ground[0], panel.ground[1] + panel.lift, panel.ground[2])
}

// ─── the faces: every card and caption printed into one texture ─────────────

const FONT_DISPLAY = 'Bahnschrift, "Barlow Condensed", "Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

function bodyFont(): string {
  let grotesk = ''
  try {
    grotesk = getComputedStyle(document.body).getPropertyValue('--font-space-grotesk').trim()
      || getComputedStyle(document.documentElement).getPropertyValue('--font-space-grotesk').trim()
  } catch { /* no styles yet */ }
  return `${grotesk ? `${grotesk}, ` : ''}"Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

// Pictures, loaded once per URL (the URL carries the file's modified time).
const pictureCache = new Map<string, HTMLImageElement | null>()

function loadPicture(url: string): Promise<void> {
  if (pictureCache.has(url)) return Promise.resolve()
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => { pictureCache.set(url, image); resolve() }
    image.onerror = () => { pictureCache.set(url, null); resolve() }
    image.src = url
  })
}

function drawPicture(ctx: CanvasRenderingContext2D, panel: WallPanel, x: number, y: number, width: number, height: number, m: number): void {
  const { mission, dimmed } = panel
  const image = mission.pictureUrl ? pictureCache.get(mission.pictureUrl) : null
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, width, height)
  ctx.clip()
  if (image) {
    // Cover the 16:9 slot, centred.
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
    const w = image.naturalWidth * scale
    const h = image.naturalHeight * scale
    ctx.fillStyle = '#05070d'
    ctx.fillRect(x, y, width, height)
    ctx.globalAlpha = dimmed ? 0.45 : 1
    ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h)
  } else {
    const color = MISSION_COLUMN_COLOR[mission.column]
    const fill = ctx.createLinearGradient(x, y, x + width, y + height)
    fill.addColorStop(0, CARD_TINT[mission.column])
    fill.addColorStop(1, '#05070d')
    ctx.fillStyle = fill
    ctx.fillRect(x, y, width, height)
    const words = missionPosterWords(mission.title)
    const lines = words.length === 3 ? [words[0], `${words[1]} ${words[2]}`] : words.length === 2 ? words : [words[0] || '?']
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.globalAlpha = dimmed ? 0.4 : 0.95
    // As big as fits: the widest line fills the width, up to what the height holds.
    let size = Math.floor((height * 0.8) / lines.length)
    ctx.font = `700 ${size}px ${FONT_DISPLAY}`
    const widest = Math.max(...lines.map(line => ctx.measureText(line).width))
    if (widest > width * 0.9) size = Math.floor(size * (width * 0.9) / widest)
    ctx.font = `700 ${size}px ${FONT_DISPLAY}`
    const top = y + height / 2 - ((lines.length - 1) * size * 1.02) / 2
    lines.forEach((line, index) => ctx.fillText(line, x + width / 2, top + index * size * 1.02 + size * 0.04))
  }
  ctx.restore()
  void m
}

/** One panel's face at (x, y) in the texture: the picture, the card with the numbers, the TL;DR caption. */
function drawFace(ctx: CanvasRenderingContext2D, panel: WallPanel, x: number, y: number, grid: MissionAtlasGrid, body: string): void {
  const { mission, dimmed } = panel
  const m = grid.pxPerMeter
  const width = grid.tileWidth
  const cardHeight = Math.round(MISSION_PANEL.cardHeight * m)
  const gap = Math.round(MISSION_PANEL.gap * m)
  const color = MISSION_COLUMN_COLOR[mission.column]
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, width, grid.tileHeight)
  ctx.clip()
  ctx.fillStyle = FRAME_COLOR
  ctx.fillRect(x, y, width, grid.tileHeight)

  // The picture: what you recognise from across the plaza. No picture yet: the title's big words.
  const pictureHeight = Math.round(MISSION_PANEL.pictureHeight * m)
  const tileBottom = y + grid.tileHeight
  drawPicture(ctx, panel, x, y, width, pictureHeight, m)
  y += pictureHeight + gap

  // The card: the numbers.
  ctx.fillStyle = CARD_TINT[mission.column]
  ctx.fillRect(x, y, width, cardHeight)
  const strip = Math.round(0.2 * m)
  ctx.globalAlpha = dimmed ? 0.55 : 1
  ctx.fillStyle = color
  ctx.fillRect(x, y, width, strip)
  ctx.globalAlpha = 1
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#0b1020'
  ctx.font = `700 ${Math.round(0.105 * m)}px ${FONT_DISPLAY}`
  const label = `${mission.column.toUpperCase()}${mission.state !== mission.column ? `  ·  ${mission.state}` : ''}`
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(0.014 * m)}px` } catch { /* older browsers */ }
  ctx.fillText(label, x + 0.09 * m, y + strip / 2 + 1)
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px' } catch { /* older browsers */ }

  ctx.textAlign = 'center'
  ctx.globalAlpha = dimmed ? 0.5 : 1
  ctx.fillStyle = color
  ctx.font = `700 ${Math.round(0.36 * m)}px ${FONT_DISPLAY}`
  ctx.fillText(mission.priority === null ? '–' : mission.priority.toFixed(2), x + width / 2, y + strip + 0.2 * m)
  ctx.fillStyle = '#e2e8f0'
  ctx.globalAlpha = dimmed ? 0.45 : 0.85
  ctx.font = `500 ${Math.round(0.082 * m)}px ${body}`
  const score = mission.ease !== null && mission.impact !== null && mission.urgency !== null
    ? `ease ${mission.ease}  ·  impact ${mission.impact}  ·  urgency ${mission.urgency}`
    : 'no score yet'
  ctx.fillText(score, x + width / 2, y + cardHeight - 0.2 * m)
  ctx.globalAlpha = dimmed ? 0.4 : 0.65
  ctx.font = `500 ${Math.round(0.072 * m)}px ${body}`
  ctx.fillText(fitText(ctx, mission.who || 'nobody yet', width - 0.2 * m), x + width / 2, y + cardHeight - 0.08 * m)

  // The caption plate: the TL;DR, printed under the card.
  const captionTop = y + cardHeight + gap
  const captionHeight = tileBottom - captionTop
  ctx.globalAlpha = 1
  ctx.fillStyle = '#0a0f1c'
  ctx.fillRect(x, captionTop, width, captionHeight)
  ctx.fillStyle = '#f1f5f9'
  ctx.globalAlpha = dimmed ? 0.5 : 0.95
  const size = Math.round(0.09 * m)
  const lineHeight = Math.round(size * 1.28)
  ctx.font = `500 ${size}px ${body}`
  const maxLines = Math.max(1, Math.floor((captionHeight - 0.06 * m) / lineHeight))
  const lines = wrapByWidth(mission.tldr || 'No TL;DR yet.', width - 0.16 * m, maxLines, text => ctx.measureText(text).width)
  const top = captionTop + (captionHeight - lines.length * lineHeight) / 2 + lineHeight / 2
  lines.forEach((line, index) => ctx.fillText(line, x + width / 2, top + index * lineHeight))
  ctx.restore()
}

/** One quad per panel, in world space, each mapped to its tile of the texture. */
function faceGeometry(panels: WallPanel[], grid: MissionAtlasGrid): THREE.BufferGeometry {
  const positions = new Float32Array(panels.length * 12)
  const uvs = new Float32Array(panels.length * 8)
  const indices: number[] = []
  const matrix = new THREE.Matrix4()
  const corner = new THREE.Vector3()
  const halfWidth = MISSION_FACE.width / 2
  const y0 = MISSION_FACE.bottomY
  const y1 = y0 + MISSION_FACE.height
  panels.forEach((panel, index) => {
    panelMatrix(panel, matrix)
    const tile = missionAtlasTile(grid, index)
    const u0 = tile.x / grid.width
    const u1 = (tile.x + grid.tileWidth) / grid.width
    const v1 = 1 - tile.y / grid.height
    const v0 = 1 - (tile.y + grid.tileHeight) / grid.height
    const corners: Array<[number, number, number, number]> = [[-halfWidth, y0, u0, v0], [halfWidth, y0, u1, v0], [halfWidth, y1, u1, v1], [-halfWidth, y1, u0, v1]]
    corners.forEach(([cx, cy, u, v], i) => {
      corner.set(cx, cy, FACE_Z).applyMatrix4(matrix)
      positions.set([corner.x, corner.y, corner.z], index * 12 + i * 3)
      uvs.set([u, v], index * 8 + i * 2)
    })
    const base = index * 4
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function WallFaces({ panels }: { panels: WallPanel[] }) {
  const maxTextureSize = useThree(s => s.gl.capabilities.maxTextureSize)
  const anisotropy = useThree(s => s.gl.capabilities.getMaxAnisotropy())
  const invalidate = useThree(s => s.invalidate)
  const grid = useMemo(() => missionAtlasGrid(panels.length, Math.min(4096, maxTextureSize)), [panels.length, maxTextureSize])
  const atlas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = grid.width
    canvas.height = grid.height
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, anisotropy)
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    return { canvas, texture, material }
  }, [grid, anisotropy])
  useEffect(() => () => {
    atlas.texture.dispose()
    atlas.material.dispose()
  }, [atlas])

  // Print the faces: now, and again once the page's fonts are in.
  useEffect(() => {
    let cancelled = false
    const body = bodyFont()
    const print = () => {
      const ctx = atlas.canvas.getContext('2d')
      if (cancelled || !ctx) return
      panels.forEach((panel, index) => {
        const tile = missionAtlasTile(grid, index)
        drawFace(ctx, panel, tile.x, tile.y, grid, body)
      })
      atlas.texture.needsUpdate = true
      invalidate()
    }
    // Pictures arrive later: one more print when all of them are in (or failed).
    const urls = panels.map(panel => panel.mission.pictureUrl).filter((url): url is string => Boolean(url) && !pictureCache.has(url as string))
    if (urls.length) void Promise.all(urls.map(loadPicture)).then(print)
    const fonts = document.fonts
    const wanted = [`500 32px ${body}`, `700 32px ${FONT_DISPLAY}`]
    let ready = true
    try { ready = !fonts?.check || wanted.every(font => fonts.check(font)) } catch { /* unknown family: print with what there is */ }
    print()
    // Printed before the page's fonts were in: once more when they are (one upload otherwise).
    if (!ready && fonts?.load) {
      Promise.all(wanted.map(font => fonts.load(font))).then(print).catch(() => {})
    }
    return () => { cancelled = true }
  }, [atlas, grid, panels, invalidate])

  const geometry = useMemo(() => faceGeometry(panels, grid), [panels, grid])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={atlas.material} raycast={NO_RAYCAST} />
}

// ─── the frames: one instanced mesh ─────────────────────────────────────────

function WallFrames({ panels }: { panels: WallPanel[] }) {
  const frames = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = frames.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const lift = new THREE.Matrix4().makeTranslation(0, FRAME_CENTER_Y, 0)
    panels.forEach((panel, index) => mesh.setMatrixAt(index, panelMatrix(panel, matrix).multiply(lift)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [panels])
  return (
    <instancedMesh key={panels.length} ref={frames} args={[undefined, undefined, panels.length]} raycast={NO_RAYCAST}>
      <boxGeometry args={[MISSION_FACE.width + MISSION_PANEL.border * 2, FRAME_HEIGHT, MISSION_PANEL.depth]} />
      <meshStandardMaterial color={FRAME_COLOR} roughness={0.45} metalness={0.55} />
    </instancedMesh>
  )
}

// ─── the titles, spelled out in 3D letters: one merged mesh per look ────────

function titleGeometry(font: Font, title: string): THREE.BufferGeometry | null {
  const data = font.data as unknown as { glyphs: Record<string, { ha: number }>; resolution: number }
  const known = title
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .split('')
    .filter(ch => ch === ' ' || data.glyphs[ch])
    .join('')
  const scale = TITLE_SIZE / data.resolution
  const measure = (text: string) => text.replace(/…/g, '...').split('').reduce((sum, ch) => sum + (data.glyphs[ch]?.ha || 0), 0) * scale
  const lines = wrapByWidth(known, TITLE_MAX_WIDTH, 2, measure).map(line => line.replace(/…/g, '...'))
  const parts: THREE.BufferGeometry[] = []
  lines.forEach((line, index) => {
    const geometry = new TextGeometry(line, { font, size: TITLE_SIZE, height: TITLE_DEPTH, curveSegments: 3, bevelEnabled: false })
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box || !Number.isFinite(box.max.x)) {
      geometry.dispose()
      return
    }
    // Centred; the last line's baseline at y = 0, earlier lines above it.
    geometry.translate(-(box.min.x + box.max.x) / 2, (lines.length - 1 - index) * TITLE_LINE, -TITLE_DEPTH / 2)
    parts.push(geometry)
  })
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]
  const merged = mergeGeometries(parts)
  parts.forEach(part => part.dispose())
  return merged
}

/** Every title of one look (open or done), in world space, as one geometry. */
function mergedTitles(font: Font, panels: WallPanel[]): THREE.BufferGeometry | null {
  const matrix = new THREE.Matrix4()
  const lift = new THREE.Matrix4().makeTranslation(0, MISSION_PANEL.bottomY + FRAME_HEIGHT + 0.09, 0)
  const parts: THREE.BufferGeometry[] = []
  for (const panel of panels) {
    const geometry = titleGeometry(font, panel.mission.title)
    if (geometry) parts.push(geometry.applyMatrix4(panelMatrix(panel, matrix).multiply(lift)))
  }
  if (!parts.length) return null
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts)
  if (merged !== parts[0]) parts.forEach(part => part.dispose())
  merged?.computeBoundingSphere()
  return merged
}

function WallTitles({ panels, dimmed }: { panels: WallPanel[]; dimmed: boolean }) {
  const font = useLoader(FontLoader, TITLE_FONT)
  const geometry = useMemo(() => mergedTitles(font, panels.filter(panel => panel.dimmed === dimmed)), [font, panels, dimmed])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} raycast={NO_RAYCAST}>
      {dimmed
        ? <meshStandardMaterial color="#64748b" roughness={0.7} metalness={0.1} />
        : <meshStandardMaterial color="#f8fafc" emissive="#e2e8f0" emissiveIntensity={0.45} roughness={0.4} metalness={0.15} />}
    </mesh>
  )
}

/** A rim of light around the panel within reach: one mesh for the whole wall, only while near one. */
function NearbyGlow({ panels }: { panels: WallPanel[] }) {
  const nearby = useSyncExternalStore(subscribeMissions, () => getMissionState().nearby, () => null)
  const panel = nearby ? panels.find(item => item.file === nearby) : null
  if (!panel) return null
  return (
    <group position={[panel.ground[0], panel.ground[1] + panel.lift, panel.ground[2]]} rotation-y={panel.rotationY} scale={panel.scale}>
      <mesh position={[0, FRAME_CENTER_Y, 0]} raycast={NO_RAYCAST}>
        <boxGeometry args={[MISSION_FACE.width + MISSION_PANEL.border * 2 + 0.07, FRAME_HEIGHT + 0.07, MISSION_PANEL.depth * 0.6]} />
        <meshBasicMaterial color={MISSION_COLUMN_COLOR[panel.mission.column]} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ─── the wall ───────────────────────────────────────────────────────────────

export function VillageMissionWall({ roster, placements, origin }: {
  roster: VillageRosterAgent[]
  placements: Map<string, VillageStationPlacement>
  origin: VillageOrigin
}) {
  const missions = useSyncExternalStore(subscribeMissions, () => getMissionState().missions, () => getMissionState().missions)
  const terrainHeights = useOasisStore(s => s.terrainHeights)

  const panels = useMemo<WallPanel[]>(() => {
    if (!missions.length) return []
    const anorak = roster.find(agent => /anorak/i.test(agent.name))
    const desk = anorak ? placements.get(anorak.id) : null
    const layout = layoutMissionWall(missions, {
      center: plazaCenter({ origin }),
      anchor: desk ? { x: desk.position[0], z: desk.position[2] } : null,
      fallbackYaw: origin.yaw,
      desks: [...placements.values()].map(station => ({ x: station.position[0], z: station.position[2] })),
    })
    const byFile = new Map(missions.map(mission => [mission.file, mission]))
    const top = Math.max(0, ...missions.map(mission => mission.priority || 0))
    return layout.flatMap(item => {
      const mission = byFile.get(item.file)
      if (!mission) return []
      const ground: Vec3 = [item.position[0], sampleTerrainHeightAt(terrainHeights, item.position[0], item.position[2]), item.position[2]]
      return [{ ...item, mission, ground, scale: missionPanelScale(mission.priority, top) }]
    })
  }, [missions, roster, placements, origin, terrainHeights])

  useLayoutEffect(() => {
    const map = new Map<string, MissionPanelPlacement>()
    for (const panel of panels) map.set(panel.file, { position: panel.ground, rotationY: panel.rotationY })
    setMissionPanels(map)
  }, [panels])
  useEffect(() => () => setMissionPanels(new Map()), [])

  if (!panels.length) return null
  return (
    <group name="oasis-village-missions">
      {/* Today's time toward the vow, big, over the middle of the first arc. */}
      <WorkVowClock3D position={panels[0].ground} rotationY={panels[0].rotationY} />
      <WallFrames panels={panels} />
      <WallFaces panels={panels} />
      <NearbyGlow panels={panels} />
      <Suspense fallback={null}>
        <WallTitles panels={panels} dimmed={false} />
        <WallTitles panels={panels} dimmed />
      </Suspense>
    </group>
  )
}
