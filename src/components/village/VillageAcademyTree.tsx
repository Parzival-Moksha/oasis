'use client'

// ░▒▓ VILLAGE ACADEMY TREE — the skill tree, standing across the plaza from the desks ▓▒░
// Dark terraces rising away from the plaza, one per tier; on each, a medallion per skill; beams join a
// skill to what it needs. Locked: grey and small. Available: its ring pulses. Claimed: the lower half of
// its face is lit. Verified: the whole face is lit, with a glow. The skill's keys sit on its name plate as
// small gems (subscriptions gold, API keys blue). A banner on top says whose progress this is, and its level.
//
// The Oasis is main-thread bound (docs/missions/fps-ceiling.md), so whatever the number of skills the
// tree is eight draw calls: terraces, rings, glows, beams, gems (one instanced mesh each), every face and
// name plate printed into one texture on one mesh, the banner, and a ring around the node you look at.
// No drei <Html>, no text objects, no click targets, and one frame callback, subscribed only while a
// node pulses or flashes.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useFrameWhen } from '../../lib/use-frame-when'
import { sampleTerrainHeightAt } from '../../lib/forge/terrain-brush'
import { plazaCenter, stationLocalToWorld, type Vec3, type VillageOrigin } from '../../lib/village/village-layout'
import {
  ACADEMY_KEY_COLOR,
  ACADEMY_TREE,
  academyLaneColor,
  academyTreeStation,
  layoutAcademyNodes,
  nodeLook,
  type AcademyContent,
  type AcademyNodeLook,
  type AcademySkill,
  type AcademyTraineeView,
} from '../../lib/village/village-academy'
import { SettingsContext } from '../scene-lib/contexts'
import { getAcademyState, selectedTrainee, setAcademyNodes, subscribeAcademy, useAcademyEnabled } from './academy-store'

const R = ACADEMY_TREE.medallionRadius
/** The name plate stands over its medallion: a beam arriving from below never crosses it. */
const PLATE = { width: 2.3, height: 0.5, gap: 0.14 }
const BANNER = { width: 8.4, height: 1.97, px: 160 }
/** Texture pixels per meter of face and plate. */
const PX = 256
const FACE_PX = Math.round(2 * R * PX)
const PLATE_W = Math.round(PLATE.width * PX)
const PLATE_H = Math.round(PLATE.height * PX)
const TILE_PAD = 4
const TILE_W = PLATE_W + TILE_PAD * 2
const TILE_H = FACE_PX + PLATE_H + TILE_PAD * 3
const LOCKED_SCALE = 0.8
const FLASH_MS = 1600
const FONT_DISPLAY = 'Bahnschrift, "Barlow Condensed", "Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const GREY = '#4b5563'

const NO_RAYCAST = () => {}

interface TreeNode {
  skill: AcademySkill
  local: Vec3
  color: string
  look: AcademyNodeLook
  scale: number
}

// ─── printing: every face and name plate into one texture ───────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number): number {
  ctx.font = `${weight} ${size}px ${FONT_DISPLAY}`
  const width = ctx.measureText(text).width
  if (width <= maxWidth) return size
  const fitted = Math.floor(size * maxWidth / width)
  ctx.font = `${weight} ${fitted}px ${FONT_DISPLAY}`
  return fitted
}

const STATE_WORD: Record<AcademyNodeLook, string> = { locked: 'LOCKED', available: 'READY', claimed: 'CLAIMED', verified: 'VERIFIED' }

function drawTile(ctx: CanvasRenderingContext2D, node: TreeNode, x: number, y: number): void {
  const { skill, look, color } = node
  ctx.clearRect(x, y, TILE_W, TILE_H)
  const locked = look === 'locked'

  // The face: a disc with the skill's number.
  const cx = x + TILE_W / 2
  const cy = y + TILE_PAD + FACE_PX / 2
  const radius = FACE_PX / 2 - 3
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = locked ? '#1a1f2b' : '#0b1020'
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  if (look === 'verified' || look === 'claimed') {
    const top = look === 'verified' ? cy - radius : cy
    const fill = ctx.createLinearGradient(0, cy - radius, 0, cy + radius)
    fill.addColorStop(0, '#ffffff')
    fill.addColorStop(0.35, color)
    fill.addColorStop(1, color)
    ctx.fillStyle = fill
    ctx.fillRect(cx - radius, top, radius * 2, cy + radius - top)
  }
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(FACE_PX * 0.5)}px ${FONT_DISPLAY}`
  const label = String(skill.order)
  if (look === 'claimed') {
    ctx.lineWidth = 10
    ctx.strokeStyle = '#0b1020'
    ctx.strokeText(label, cx, cy + 6)
  }
  ctx.fillStyle = locked ? '#5b6474' : look === 'available' ? color : look === 'claimed' ? '#ffffff' : '#06121f'
  ctx.fillText(label, cx, cy + 6)

  // The plate: the name, then the state and the XP.
  const px = x + TILE_PAD
  const py = y + TILE_PAD * 2 + FACE_PX
  roundRect(ctx, px + 3, py + 3, PLATE_W - 6, PLATE_H - 6, 22)
  ctx.fillStyle = locked ? '#11151e' : '#0a0f1c'
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = locked ? '#374151' : color
  ctx.stroke()
  const name = skill.name.toUpperCase()
  fitFont(ctx, name, 700, Math.round(PLATE_H * 0.46), PLATE_W - 44)
  ctx.fillStyle = locked ? '#7c8596' : '#f8fafc'
  ctx.fillText(name, px + PLATE_W / 2, py + PLATE_H * 0.36)
  ctx.font = `600 ${Math.round(PLATE_H * 0.23)}px ${FONT_DISPLAY}`
  ctx.fillStyle = locked ? '#6b7280' : color
  const sub = `${STATE_WORD[look]}${look === 'verified' ? ' ✓' : ''}  ·  ${look === 'available' ? '+' : ''}${skill.xp} XP`
  ctx.fillText(sub, px + PLATE_W / 2, py + PLATE_H * 0.76)
}

function atlasGrid(count: number): { cols: number; rows: number; width: number; height: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / cols))
  return { cols, rows, width: cols * TILE_W, height: rows * TILE_H }
}

/** Two quads per node (face, plate), in the tree's own frame, each mapped to its part of the node's tile. */
function labelGeometry(nodes: TreeNode[]): THREE.BufferGeometry {
  const grid = atlasGrid(nodes.length)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const quad = (cx: number, cy: number, z: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number) => {
    const base = positions.length / 3
    positions.push(cx - w / 2, cy - h / 2, z, cx + w / 2, cy - h / 2, z, cx + w / 2, cy + h / 2, z, cx - w / 2, cy + h / 2, z)
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  nodes.forEach((node, index) => {
    const tx = (index % grid.cols) * TILE_W
    const ty = Math.floor(index / grid.cols) * TILE_H
    const u = (px: number) => px / grid.width
    const v = (py: number) => 1 - py / grid.height
    const [x, y, z] = node.local
    const s = node.scale
    const faceX = tx + (TILE_W - FACE_PX) / 2
    quad(x, y, z + 0.02, 2 * R * s, 2 * R * s, u(faceX), v(ty + TILE_PAD + FACE_PX), u(faceX + FACE_PX), v(ty + TILE_PAD))
    const plateTop = ty + TILE_PAD * 2 + FACE_PX
    quad(x, y + (R + PLATE.gap + PLATE.height / 2) * s, z + 0.02, PLATE.width * s, PLATE.height * s, u(tx + TILE_PAD), v(plateTop + PLATE_H), u(tx + TILE_PAD + PLATE_W), v(plateTop))
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function useCanvasTexture(width: number, height: number) {
  const anisotropy = useThree(s => s.gl.capabilities.getMaxAnisotropy())
  const made = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, anisotropy)
    return { canvas, texture }
  }, [width, height, anisotropy])
  useEffect(() => () => made.texture.dispose(), [made])
  return made
}

/** Print now, and once more when the page's display font has arrived. */
function usePrint(print: () => void, deps: unknown[]): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false
    print()
    const fonts = document.fonts
    const wanted = `700 32px ${FONT_DISPLAY}`
    let ready = true
    try { ready = !fonts?.check || fonts.check(wanted) } catch { /* unknown family: print with what there is */ }
    if (!ready && fonts?.load) fonts.load(wanted).then(() => { if (!cancelled) print() }).catch(() => {})
    return () => { cancelled = true }
  }, deps)
}

function Labels({ nodes }: { nodes: TreeNode[] }) {
  const invalidate = useThree(s => s.invalidate)
  const grid = atlasGrid(nodes.length)
  const { canvas, texture } = useCanvasTexture(grid.width, grid.height)
  const material = useMemo(() => new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, toneMapped: false }), [texture])
  useEffect(() => () => material.dispose(), [material])
  usePrint(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    nodes.forEach((node, index) => drawTile(ctx, node, (index % grid.cols) * TILE_W, Math.floor(index / grid.cols) * TILE_H))
    texture.needsUpdate = true
    invalidate()
  }, [canvas, texture, nodes, grid.cols, invalidate])
  const geometry = useMemo(() => labelGeometry(nodes), [nodes])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} raycast={NO_RAYCAST} />
}

// ─── the banner: whose tree this is ─────────────────────────────────────────

function Banner({ trainee, content, position }: { trainee: AcademyTraineeView | null; content: AcademyContent; position: Vec3 }) {
  const invalidate = useThree(s => s.invalidate)
  const width = BANNER.width * BANNER.px
  const height = BANNER.height * BANNER.px
  const { canvas, texture } = useCanvasTexture(width, height)
  const material = useMemo(() => new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, toneMapped: false }), [texture])
  useEffect(() => () => material.dispose(), [material])
  const key = trainee ? [trainee.key, trainee.name, trainee.level.name, trainee.xp.score, trainee.xp.verified, trainee.xp.claimed, trainee.stone ? 1 : 0].join('\u0001') : ''
  const done = trainee ? content.skills.filter(skill => trainee.skills[skill.id]?.state === 'verified').length : 0
  usePrint(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const gold = '#fbbf24'
    ctx.clearRect(0, 0, width, height)
    roundRect(ctx, 6, 6, width - 12, height - 12, 44)
    ctx.fillStyle = '#080c17'
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = trainee ? gold : '#475569'
    ctx.stroke()
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#94a3b8'
    ctx.font = `600 ${Math.round(height * 0.13)}px ${FONT_DISPLAY}`
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '8px' } catch { /* older browsers */ }
    ctx.fillText('OASIS ACADEMY', 60, height * 0.2)
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px' } catch { /* older browsers */ }
    if (!trainee) {
      ctx.fillStyle = '#e2e8f0'
      fitFont(ctx, 'NO TRAINEE YET', 700, Math.round(height * 0.34), width - 120)
      ctx.fillText('NO TRAINEE YET', 60, height * 0.52)
      ctx.fillStyle = '#94a3b8'
      ctx.font = `500 ${Math.round(height * 0.13)}px ${FONT_DISPLAY}`
      ctx.fillText('Open an agent and switch Train on', 60, height * 0.82)
      texture.needsUpdate = true
      invalidate()
      return
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = '#94a3b8'
    ctx.font = `600 ${Math.round(height * 0.13)}px ${FONT_DISPLAY}`
    ctx.fillText(`${done} of ${content.skills.length} skills${trainee.stone ? '  ·  STONE' : ''}`, width - 60, height * 0.2)
    // Name on the left, level on the right.
    const level = trainee.level.name.toUpperCase()
    ctx.fillStyle = gold
    ctx.font = `700 ${Math.round(height * 0.3)}px ${FONT_DISPLAY}`
    const levelWidth = ctx.measureText(level).width
    ctx.fillText(level, width - 60, height * 0.5)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#f8fafc'
    const name = trainee.name.toUpperCase()
    fitFont(ctx, name, 700, Math.round(height * 0.38), width - 180 - levelWidth)
    ctx.fillText(name, 60, height * 0.5)
    // XP toward the next level.
    const next = trainee.level.next
    const barX = 60
    const barY = height * 0.74
    const barH = height * 0.11
    const text = next ? `${trainee.xp.score} / ${next.xp} XP  →  ${next.name}` : `${trainee.xp.score} XP`
    ctx.font = `600 ${Math.round(height * 0.14)}px ${FONT_DISPLAY}`
    ctx.textAlign = 'right'
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText(text, width - 60, barY + barH / 2 + 2)
    const barW = width - 120 - ctx.measureText(text).width - 40
    const share = next ? Math.min(1, Math.max(0, (trainee.xp.score - trainee.level.xp) / Math.max(1, next.xp - trainee.level.xp))) : 1
    roundRect(ctx, barX, barY, barW, barH, barH / 2)
    ctx.fillStyle = '#1e293b'
    ctx.fill()
    if (share > 0) {
      roundRect(ctx, barX, barY, Math.max(barH, barW * share), barH, barH / 2)
      ctx.fillStyle = gold
      ctx.fill()
    }
    texture.needsUpdate = true
    invalidate()
  }, [canvas, texture, key, done, content.skills.length, invalidate])
  return (
    <mesh position={position} material={material} raycast={NO_RAYCAST}>
      <planeGeometry args={[BANNER.width, BANNER.height]} />
    </mesh>
  )
}

// ─── the instanced parts ────────────────────────────────────────────────────

interface Edge { from: number; to: number }
/** One dark block per tier: its front face stands behind that tier's row, its top is the next tier's floor. */
interface Terrace { center: Vec3; size: Vec3 }

/** How far a row's block face stands behind its medallions. */
const TERRACE_BACK = 0.26
/** From a medallion's centre down to the floor its row stands on. */
const ROW_FOOT = R + 0.16
/** From a medallion's centre up to the top of its plate and its gems. */
const ROW_HEAD = R + PLATE.gap + PLATE.height + 0.3

function layoutTerraces(nodes: TreeNode[]): { terraces: Terrace[]; top: number; back: number } {
  const rows = [...new Map(nodes.map(node => [node.local[2], node.local[1]])).entries()]
    .map(([z, y]) => ({ z, y }))
    .sort((a, b) => a.y - b.y)
  const xs = nodes.map(node => node.local[0])
  const width = Math.max(...xs) - Math.min(...xs) + PLATE.width + 1
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2
  const last = rows[rows.length - 1]
  // Every block reaches back to one wall behind the top row.
  const wall = last.z - TERRACE_BACK - 0.9
  const terraces = rows.map((row, index) => {
    const next = rows[index + 1]
    // Up to the next row's floor; the last block clears its own medallions and carries the banner.
    const top = next ? next.y - ROW_FOOT : row.y + ROW_HEAD + 0.1
    const blockDepth = row.z - TERRACE_BACK - wall
    return {
      center: [centerX, top / 2 - 0.2, row.z - TERRACE_BACK - blockDepth / 2] as Vec3,
      size: [width, top + 0.4, blockDepth] as Vec3,
    }
  })
  return { terraces, top: last.y + ROW_HEAD + 0.1, back: last.z - TERRACE_BACK - 0.45 }
}
interface Gem { node: number; index: number; of: number; color: string }

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const fill = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    fill.addColorStop(0, 'rgba(255,255,255,0.9)')
    fill.addColorStop(0.35, 'rgba(255,255,255,0.4)')
    fill.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, 128, 128)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const RING_GLOW: Record<AcademyNodeLook, number> = { locked: 1, available: 1.1, claimed: 0.85, verified: 2.2 }
const HALO_GLOW: Record<AcademyNodeLook, number> = { locked: 0, available: 0.25, claimed: 0.3, verified: 1 }

function Parts({ nodes, terraces, edges, gems, flashKey }: { nodes: TreeNode[]; terraces: Terrace[]; edges: Edge[]; gems: Gem[]; flashKey: string }) {
  const steps = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.InstancedMesh>(null)
  const halos = useRef<THREE.InstancedMesh>(null)
  const beams = useRef<THREE.InstancedMesh>(null)
  const gemMesh = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree(s => s.invalidate)
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(),
    color: new THREE.Color(), a: new THREE.Vector3(), b: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), identity: new THREE.Quaternion(),
  }), [])
  const glow = useMemo(() => glowTexture(), [])
  useEffect(() => () => glow.dispose(), [glow])
  // Rings, beams and gems: one material, coloured per instance.
  const lit = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  useEffect(() => () => lit.dispose(), [lit])

  // Looks that changed for the same trainee flash for a moment: the camera can catch a skill lighting up.
  const previous = useRef<{ key: string; looks: Map<string, AcademyNodeLook> }>({ key: '', looks: new Map() })
  const flashes = useRef(new Map<number, number>())
  const [flashing, setFlashing] = useState(false)

  const setRing = (index: number, scale: number, glowBy: number) => {
    const node = nodes[index]
    const mesh = rings.current
    if (!mesh) return
    scratch.matrix.compose(scratch.position.set(...node.local), scratch.identity, scratch.scale.setScalar(node.scale * scale))
    mesh.setMatrixAt(index, scratch.matrix)
    mesh.setColorAt(index, scratch.color.set(node.look === 'locked' ? GREY : node.color).multiplyScalar(glowBy))
  }
  const setHalo = (index: number, scale: number, glowBy: number) => {
    const node = nodes[index]
    const mesh = halos.current
    if (!mesh) return
    const size = glowBy > 0 ? 3.6 * R * node.scale * scale : 0
    scratch.matrix.compose(scratch.position.set(node.local[0], node.local[1], node.local[2] - 0.07), scratch.identity, scratch.scale.set(size, size, 1))
    mesh.setMatrixAt(index, scratch.matrix)
    mesh.setColorAt(index, scratch.color.set(node.color).multiplyScalar(glowBy))
  }
  const flush = (...meshes: Array<THREE.InstancedMesh | null>) => {
    for (const mesh of meshes) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  useLayoutEffect(() => {
    const now = performance.now()
    const before = previous.current
    const looks = new Map(nodes.map(node => [node.skill.id, node.look]))
    if (before.key === flashKey) {
      nodes.forEach((node, index) => {
        const was = before.looks.get(node.skill.id)
        if (was && was !== node.look && (node.look === 'verified' || node.look === 'claimed')) flashes.current.set(index, now)
      })
    } else flashes.current.clear()
    previous.current = { key: flashKey, looks }
    setFlashing(flashes.current.size > 0)

    nodes.forEach((node, index) => {
      setRing(index, 1, RING_GLOW[node.look])
      setHalo(index, 1, HALO_GLOW[node.look])
    })
    if (steps.current) {
      terraces.forEach((terrace, index) => {
        scratch.matrix.compose(scratch.position.set(...terrace.center), scratch.identity, scratch.scale.set(...terrace.size))
        steps.current!.setMatrixAt(index, scratch.matrix)
      })
    }
    if (beams.current) {
      edges.forEach((edge, index) => {
        const from = nodes[edge.from]
        const to = nodes[edge.to]
        // From behind the medallion it leaves to the rim of the one it reaches.
        scratch.a.set(from.local[0], from.local[1], from.local[2] - 0.1)
        scratch.b.set(to.local[0], to.local[1], to.local[2] - 0.1)
        scratch.position.copy(scratch.b).sub(scratch.a).normalize()
        scratch.b.addScaledVector(scratch.position, -R * to.scale)
        const length = scratch.a.distanceTo(scratch.b)
        scratch.quaternion.setFromUnitVectors(scratch.axis, scratch.position)
        scratch.matrix.compose(scratch.position.copy(scratch.a).add(scratch.b).multiplyScalar(0.5), scratch.quaternion, scratch.scale.set(length, 1, 1))
        beams.current!.setMatrixAt(index, scratch.matrix)
        // Lit once what it needs is done: bright when verified, half when only claimed.
        const lit = from.look === 'verified' ? 1.7 : from.look === 'claimed' ? 0.7 : 0
        beams.current!.setColorAt(index, lit ? scratch.color.set(to.color).multiplyScalar(lit) : scratch.color.set('#2a3140'))
      })
    }
    if (gemMesh.current) {
      gems.forEach((gem, index) => {
        const node = nodes[gem.node]
        // A row of studs on top of the name plate.
        const across = (gem.index - (gem.of - 1) / 2) * 0.21 * node.scale
        const up = (R + PLATE.gap + PLATE.height + 0.11) * node.scale
        scratch.matrix.compose(
          scratch.position.set(node.local[0] + across, node.local[1] + up, node.local[2] + 0.03),
          scratch.identity,
          scratch.scale.setScalar(node.scale),
        )
        gemMesh.current!.setMatrixAt(index, scratch.matrix)
        gemMesh.current!.setColorAt(index, scratch.color.set(gem.color).multiplyScalar(node.look === 'locked' ? 0.6 : 1.25))
      })
    }
    const all = [steps.current, rings.current, halos.current, beams.current, gemMesh.current]
    flush(...all)
    for (const mesh of all) mesh?.computeBoundingSphere()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, terraces, edges, gems, flashKey])

  const pulsing = useMemo(() => nodes.flatMap((node, index) => (node.look === 'available' ? [index] : [])), [nodes])

  // The one frame callback of the tree: available nodes breathe, a node that just lit up flashes.
  useFrameWhen(pulsing.length > 0 || flashing, ({ clock, camera }) => {
    // Too far to see a ring breathe: nothing to do.
    const at = rings.current?.matrixWorld.elements
    if (at && !flashes.current.size && Math.hypot(camera.position.x - at[12], camera.position.z - at[14]) > 70) return
    const wave = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.4)
    for (const index of pulsing) {
      setRing(index, 1 + 0.07 * wave, 0.6 + 1.3 * wave)
      setHalo(index, 0.9 + 0.25 * wave, 0.1 + 0.34 * wave)
    }
    if (flashes.current.size) {
      const now = performance.now()
      for (const [index, startedAt] of flashes.current) {
        const node = nodes[index]
        const t = (now - startedAt) / FLASH_MS
        if (!node || t >= 1) {
          flashes.current.delete(index)
          if (node) {
            setRing(index, 1, RING_GLOW[node.look])
            setHalo(index, 1, HALO_GLOW[node.look])
          }
          continue
        }
        const burst = Math.sin(Math.PI * Math.min(1, t * 1.6)) // out fast, back slowly
        const fade = 1 - t
        setRing(index, 1 + 0.35 * burst, RING_GLOW[node.look] + 4 * fade)
        setHalo(index, 1 + 1.9 * burst, Math.max(HALO_GLOW[node.look], 0.4) + 2.4 * fade)
      }
      if (!flashes.current.size) setFlashing(false)
    }
    flush(rings.current, halos.current)
  })

  return (
    <>
      <instancedMesh key={`steps-${terraces.length}`} ref={steps} args={[undefined, undefined, terraces.length]} raycast={NO_RAYCAST} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#111726" roughness={0.82} metalness={0.25} />
      </instancedMesh>
      <instancedMesh key={`rings-${nodes.length}`} ref={rings} args={[undefined, undefined, nodes.length]} material={lit} raycast={NO_RAYCAST}>
        <torusGeometry args={[R, 0.055, 10, 48]} />
      </instancedMesh>
      <instancedMesh key={`halos-${nodes.length}`} ref={halos} args={[undefined, undefined, nodes.length]} raycast={NO_RAYCAST} renderOrder={-1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
      {edges.length > 0 && (
        <instancedMesh key={`beams-${edges.length}`} ref={beams} args={[undefined, undefined, edges.length]} material={lit} raycast={NO_RAYCAST}>
          <boxGeometry args={[1, 0.07, 0.07]} />
        </instancedMesh>
      )}
      {gems.length > 0 && (
        <instancedMesh key={`gems-${gems.length}`} ref={gemMesh} args={[undefined, undefined, gems.length]} material={lit} raycast={NO_RAYCAST}>
          <sphereGeometry args={[0.085, 12, 8]} />
        </instancedMesh>
      )}
    </>
  )
}

/** A white ring around the node the owner looks at. */
function PickedRing({ nodes }: { nodes: TreeNode[] }) {
  const nearby = useSyncExternalStore(subscribeAcademy, () => getAcademyState().nearby, () => null)
  const node = nearby ? nodes.find(item => item.skill.id === nearby) : null
  if (!node) return null
  return (
    <mesh position={[node.local[0], node.local[1], node.local[2] + 0.04]} scale={node.scale} raycast={NO_RAYCAST}>
      <torusGeometry args={[R + 0.11, 0.028, 8, 56]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
  )
}

// ─── the tree ───────────────────────────────────────────────────────────────

export function VillageAcademyTree({ origin }: { origin: VillageOrigin }) {
  // Off unless asked for (Config → Agents → Skill tree in the world): the skill map is the main way in.
  const { settings } = useContext(SettingsContext)
  const enabled = useAcademyEnabled() && settings.villageAcademyTree === true
  const content = useSyncExternalStore(subscribeAcademy, () => getAcademyState().content, () => null)
  const trainee = useSyncExternalStore(subscribeAcademy, () => selectedTrainee(), () => null)
  const terrainHeights = useOasisStore(s => s.terrainHeights)

  const station = useMemo(() => {
    const foot = academyTreeStation(plazaCenter({ origin }), origin.yaw)
    const y = sampleTerrainHeightAt(terrainHeights, foot.position[0], foot.position[2])
    return { position: [foot.position[0], y, foot.position[2]] as Vec3, rotationY: foot.rotationY }
  }, [origin, terrainHeights])

  const layout = useMemo(() => (content ? layoutAcademyNodes(content.skills) : []), [content])

  // One string for every look: a poll that changed nothing here rebuilds nothing.
  const looksKey = content ? content.skills.map(skill => nodeLook(trainee, skill)).join(',') : ''
  const nodes = useMemo<TreeNode[]>(() => {
    if (!content) return []
    const looks = looksKey.split(',') as AcademyNodeLook[]
    const at = new Map(layout.map(item => [item.id, item.local]))
    return content.skills.flatMap((skill, index) => {
      const local = at.get(skill.id)
      if (!local) return []
      const look = looks[index] || 'locked'
      return [{ skill, local, color: academyLaneColor(skill.lane), look, scale: look === 'locked' ? LOCKED_SCALE : 1 }]
    })
  }, [content, layout, looksKey])

  const edges = useMemo<Edge[]>(() => {
    const index = new Map(nodes.map((node, i) => [node.skill.id, i]))
    return nodes.flatMap((node, to) => node.skill.needs.flatMap(id => {
      const from = index.get(id)
      return from === undefined ? [] : [{ from, to }]
    }))
  }, [nodes])

  const gems = useMemo<Gem[]>(() => {
    if (!content) return []
    const kinds = new Map(content.keys.map(key => [key.id, key.kind]))
    return nodes.flatMap((node, index) => node.skill.keys.map((id, i) => ({
      node: index, index: i, of: node.skill.keys.length, color: ACADEMY_KEY_COLOR[kinds.get(id) || 'account'],
    })))
  }, [content, nodes])

  // Where each node is in the world, for "look at it and press E".
  useLayoutEffect(() => {
    if (!enabled) {
      setAcademyNodes([], null)
      return
    }
    setAcademyNodes(layout.map(item => ({ id: item.id, position: stationLocalToWorld(station, item.local) })), station)
  }, [enabled, layout, station])
  useEffect(() => () => setAcademyNodes([], null), [])

  const steps = useMemo(() => (nodes.length ? layoutTerraces(nodes) : null), [nodes])

  if (!enabled || !content || !nodes.length || !steps) return null
  return (
    <group name="oasis-village-academy" position={station.position} rotation-y={station.rotationY}>
      <Parts nodes={nodes} terraces={steps.terraces} edges={edges} gems={gems} flashKey={trainee?.key || ''} />
      <Labels nodes={nodes} />
      <Banner trainee={trainee} content={content} position={[0, steps.top + 0.25 + BANNER.height / 2, steps.back]} />
      <PickedRing nodes={nodes} />
    </group>
  )
}
