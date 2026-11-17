// ░▒▓ ACADEMY SKILL MAP — the skill tree as a board you drag and zoom, laid over the world ▓▒░
// Pure: where each skill stands on the board, which lines join them, which node the pointer is on,
// what the keys mean. No DOM, no three.js (VillageAcademyMap.tsx draws it).
//
// The board is a wheel. The tier-0 skills (the core) sit in the middle; every lane is a slice of the
// wheel, every tier a ring, so a skill stands further out the later it comes. Units are "node
// widths-ish" (a node with its label is about 2.7 wide), y up.

import type { AcademyLane, AcademySkill } from './village-academy'

export const ACADEMY_MAP = {
  /** Room a node with its label takes along a ring. */
  footprint: 2.7,
  /** From the core ring to the first ring, and between rings. */
  firstGap: 4.0,
  ringGap: 4.0,
  /** A small tree (no slice is crowded) stands closer together. */
  compactFirstGap: 3.3,
  compactRingGap: 3.1,
  /** A crowded slice puts every second node this far further out. */
  stagger: 1.7,
  /** The least a slice gets, and the air between slices, in radians. */
  minSlice: 0.2,
  slicePad: 0.07,
  /** The pointer is "on" a node within this distance of its centre. */
  hitRadius: 1.05,
  /** How far the lane names stand beyond the last ring. */
  laneLabelGap: 3.0,
}

export interface AcademyMapNode {
  id: string
  x: number
  y: number
  tier: number
  lane: string
}

export interface AcademyMapLane {
  id: string
  name: string
  /** The middle of its slice, radians, 0 = +x, counter-clockwise. */
  angle: number
  /** Where its name stands. */
  x: number
  y: number
}

export interface AcademyMapEdge {
  from: string
  to: string
  /** `need`: a real requirement. `branch`: a skill that needs nothing, tied to the branch it grows from. */
  kind: 'need' | 'branch'
}

export interface AcademyMapLayout {
  nodes: AcademyMapNode[]
  lanes: AcademyMapLane[]
  edges: AcademyMapEdge[]
  /** Ring radii, the core ring first. */
  rings: number[]
  /** Everything fits in a circle of this radius. */
  radius: number
}

/**
 * Lay the skills out on the wheel. Stable: the same skills always land in the same places, and a
 * skill's place does not depend on anyone's progress.
 */
export function layoutAcademyMap(skills: AcademySkill[], lanes: AcademyLane[]): AcademyMapLayout {
  const M = ACADEMY_MAP
  const sorted = [...skills].sort((a, b) => a.order - b.order)
  const tiers = [...new Set(sorted.map(skill => skill.tier))].sort((a, b) => a - b)
  const coreTier = tiers[0] ?? 0
  const core = sorted.filter(skill => skill.tier === coreTier)
  const outer = sorted.filter(skill => skill.tier !== coreTier)
  const outerTiers = tiers.slice(1)
  const laneIds = lanes.map(lane => lane.id).filter(id => outer.some(skill => skill.lane === id))
  for (const skill of outer) if (!laneIds.includes(skill.lane)) laneIds.push(skill.lane)

  const coreRadius = core.length <= 1 ? 0 : Math.max(1.75, (core.length * M.footprint) / (2 * Math.PI))
  let gaps = { first: M.firstGap, ring: M.ringGap }
  let baseRing = (index: number) => coreRadius + gaps.first + index * gaps.ring

  // A slice is as wide as its most crowded ring needs (two staggered rows from two nodes up).
  const cell = (lane: string, tier: number) => outer.filter(skill => skill.lane === lane && skill.tier === tier)
  const slots = (count: number) => (count >= 2 ? Math.ceil(count / 2) : count)
  const want = laneIds.map(lane => {
    let angle = M.minSlice
    outerTiers.forEach((tier, index) => {
      const count = cell(lane, tier).length
      if (count) angle = Math.max(angle, (slots(count) * M.footprint) / baseRing(index))
    })
    return angle + M.slicePad
  })
  const total = want.reduce((sum, angle) => sum + angle, 0)
  // Plenty of room around the wheel: pull the rings in (as long as it still fits one turn).
  if (total < Math.PI * 1.2) {
    gaps = { first: M.compactFirstGap, ring: M.compactRingGap }
    baseRing = (index: number) => coreRadius + gaps.first + index * gaps.ring
  }
  // Too much for one turn: the whole wheel grows. Room to spare: the slices share it.
  const grow = total > 2 * Math.PI ? total / (2 * Math.PI) : 1
  const slices = want.map(angle => (total > 0 ? (angle / total) * 2 * Math.PI : 0))
  const ring = (index: number) => baseRing(index) * grow

  const nodes: AcademyMapNode[] = []
  core.forEach((skill, index) => {
    const angle = Math.PI / 2 - (index * 2 * Math.PI) / Math.max(1, core.length)
    nodes.push({ id: skill.id, x: round(Math.cos(angle) * coreRadius), y: round(Math.sin(angle) * coreRadius), tier: skill.tier, lane: skill.lane })
  })

  // Slices run clockwise from the top, the first lane straddling "up".
  const mapLanes: AcademyMapLane[] = []
  let cursor = Math.PI / 2 + (slices[0] || 0) / 2
  const lastRing = outerTiers.length ? ring(outerTiers.length - 1) + M.stagger / 2 : coreRadius
  laneIds.forEach((lane, laneIndex) => {
    const slice = slices[laneIndex]
    const middle = cursor - slice / 2
    cursor -= slice
    outerTiers.forEach((tier, tierIndex) => {
      const here = cell(lane, tier)
      if (!here.length) return
      // One row when the slice has the room (a small tree), two staggered rows when it is crowded.
      const staggered = here.length >= 2 && here.length * M.footprint > (slice - M.slicePad) * ring(tierIndex)
      const perRow = staggered ? slots(here.length) : here.length
      here.forEach((skill, index) => {
        const row = staggered ? index % 2 : 0
        const slot = staggered ? Math.floor(index / 2) : index
        const inRow = staggered ? (row === 0 ? Math.ceil(here.length / 2) : Math.floor(here.length / 2)) : here.length
        const radius = ring(tierIndex) + (staggered ? (row === 0 ? -M.stagger / 2 : M.stagger / 2) : 0)
        // Spread over the slice, never wider apart than it needs to breathe.
        const step = Math.min((slice - M.slicePad) / Math.max(1, perRow), (M.footprint * 2.1) / radius)
        const offset = (slot - (inRow - 1) / 2) * step + (staggered && row === 1 && inRow === perRow ? step / 2 : 0)
        const angle = middle - offset
        nodes.push({ id: skill.id, x: round(Math.cos(angle) * radius), y: round(Math.sin(angle) * radius), tier: skill.tier, lane: skill.lane })
      })
    })
    const labelRadius = lastRing + M.laneLabelGap
    mapLanes.push({
      id: lane,
      name: lanes.find(item => item.id === lane)?.name || lane,
      angle: middle,
      x: round(Math.cos(middle) * labelRadius),
      y: round(Math.sin(middle) * labelRadius),
    })
  })

  // Lines: every need; and a skill that needs nothing grows from the nearest skill one step in
  // (its own lane first), so the whole tree hangs together from the core.
  const at = new Map(nodes.map(node => [node.id, node]))
  const edges: AcademyMapEdge[] = []
  for (const skill of sorted) {
    const node = at.get(skill.id)
    if (!node) continue
    const needs = skill.needs.filter(id => at.has(id))
    for (const id of needs) edges.push({ from: id, to: skill.id, kind: 'need' })
    if (needs.length || skill.tier === coreTier) continue
    const inner = nodes.filter(other => other.tier < node.tier)
    const sameLane = inner.filter(other => other.lane === node.lane)
    const pool = sameLane.length ? sameLane : inner.filter(other => other.tier === coreTier)
    let best: AcademyMapNode | null = null
    let bestDistance = Infinity
    for (const other of pool) {
      const distance = Math.hypot(other.x - node.x, other.y - node.y)
      if (distance < bestDistance) {
        best = other
        bestDistance = distance
      }
    }
    if (best) edges.push({ from: best.id, to: skill.id, kind: 'branch' })
  }

  const radius = Math.max(coreRadius, ...nodes.map(node => Math.hypot(node.x, node.y)), ...mapLanes.map(lane => Math.hypot(lane.x, lane.y))) + M.footprint
  return { nodes, lanes: mapLanes, edges, rings: [coreRadius, ...outerTiers.map((_, index) => round(ring(index)))], radius: round(radius) }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** The node under a point of the board, if any: the nearest within reach. */
export function pickMapNode(nodes: AcademyMapNode[], x: number, y: number, reach = ACADEMY_MAP.hitRadius): string | null {
  let best: string | null = null
  let bestDistance = reach
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y)
    if (distance <= bestDistance) {
      best = node.id
      bestDistance = distance
    }
  }
  return best
}

// ─── the view: pan and zoom ─────────────────────────────────────────────────

export interface AcademyMapView {
  /** The board point in the middle of the screen. */
  x: number
  y: number
  /** Board units across the screen's height. */
  span: number
}

export const ACADEMY_MAP_ZOOM = { min: 9, wheel: 0.0014 }

/** A zoom at which names can be read: what the map opens on when the whole board is bigger than that. */
export const ACADEMY_MAP_OPEN_SPAN = 30

/** How the map opens: on the core, close enough to read; a small board whole. */
export function openMapView(radius: number): AcademyMapView {
  const whole = fitMapView(radius)
  return { ...whole, span: Math.min(whole.span, ACADEMY_MAP_OPEN_SPAN) }
}

/** The whole board, with a margin. */
export function fitMapView(radius: number): AcademyMapView {
  return { x: 0, y: 0, span: Math.max(ACADEMY_MAP_ZOOM.min, radius * 2.1) }
}

/** Keep the view on the board: zoom between "a handful of nodes" and "everything", the centre within the wheel. */
export function clampMapView(view: AcademyMapView, radius: number): AcademyMapView {
  const span = Math.min(Math.max(view.span, ACADEMY_MAP_ZOOM.min), Math.max(ACADEMY_MAP_ZOOM.min, radius * 2.6))
  const reach = Math.hypot(view.x, view.y)
  const scale = reach > radius ? radius / reach : 1
  return { x: view.x * scale, y: view.y * scale, span }
}

/**
 * Wheel: zoom by `delta` (pixels of scroll, down = out) keeping the board point under the pointer
 * where it is. `px`, `py`: the pointer from the screen's middle, as a share of its height (y up).
 */
export function zoomMapView(view: AcademyMapView, delta: number, px: number, py: number, radius: number): AcademyMapView {
  const span = clampMapView({ ...view, span: view.span * Math.exp(delta * ACADEMY_MAP_ZOOM.wheel) }, radius).span
  const bx = view.x + px * view.span
  const by = view.y + py * view.span
  return clampMapView({ x: bx - px * span, y: by - py * span, span }, radius)
}

// ─── looks ──────────────────────────────────────────────────────────────────

/** How a lane's nodes are cut and patterned: a frame with this many corners (0: round) and one of the face patterns. */
export const ACADEMY_MAP_PATTERNS = ['rings', 'rays', 'dots', 'stripes', 'cells', 'waves', 'chevrons'] as const
export type AcademyMapPattern = typeof ACADEMY_MAP_PATTERNS[number]
const FRAMES = [0, 6, 8, 4, 5]

export function academyLaneLook(laneIndex: number): { corners: number; pattern: AcademyMapPattern } {
  const index = Math.max(0, Math.floor(laneIndex))
  return { corners: FRAMES[index % FRAMES.length], pattern: ACADEMY_MAP_PATTERNS[index % ACADEMY_MAP_PATTERNS.length] }
}

// ─── keys ───────────────────────────────────────────────────────────────────

export const ACADEMY_MAP_KEY = 'KeyK'

export interface AcademyMapKeyContext {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  repeat: boolean
  typing: boolean
  mapOpen: boolean
  /** A skill's sheet is open over the map: it takes Esc first. */
  readerOpen: boolean
  /** The keychain is open (over the map or alone): it takes Esc, and K waits. */
  keychainOpen: boolean
  /** An agent's panel is open: K is a letter there, or a key of its own. */
  agentOpen: boolean
  worldKeysFree: boolean
}

/** K opens the skill map and closes it; Esc closes it (after the open sheet). */
export function academyMapKeyAction(c: AcademyMapKeyContext): 'open' | 'close' | null {
  if (c.ctrl || c.meta || c.alt || c.repeat || c.keychainOpen) return null
  if (c.mapOpen) {
    if (c.readerOpen) return null
    if (c.code === 'Escape') return 'close'
    return c.code === ACADEMY_MAP_KEY && !c.typing ? 'close' : null
  }
  if (c.typing || c.agentOpen || !c.worldKeysFree) return null
  return c.code === ACADEMY_MAP_KEY ? 'open' : null
}
