// ░▒▓ VILLAGE MISSIONS — the owner's missions as framed panels behind Anorak's desk ▓▒░
// Pure: parsing a mission file, ranking, the wall's layout, the keys. No fs, no three.js.
//
// A mission is a markdown file (C:\7c_oasis\docs\missions\*.md) that starts with header lines:
//     state: idea | agreed | doing | shipped | verified
//     who: ...
//     done when: one sentence a person can check
//     score: ease 3 · impact 5 · urgency 4
// Priority = ease × impact × urgency ÷ 125. The kanban column is the state. The ranking matches
// scripts/missions_board.py in 7c_oasis.

import type { Vec3 } from './village-layout'

export type MissionColumn = 'to do' | 'doing' | 'done'

export interface Mission {
  /** File name, e.g. `mission-wall.md`: the mission's id. */
  file: string
  title: string
  state: string
  column: MissionColumn
  who: string
  doneWhen: string
  ease: number | null
  impact: number | null
  urgency: number | null
  /** 0..1, two decimals; null when the score line is missing or incomplete. */
  priority: number | null
  /** The `done when` line, or the first paragraph. */
  tldr: string
  /** The `picture:` header line: an image file in the missions folder's `pictures/`. */
  picture: string
  /** Where the Oasis loads the picture from (set by the API when the file exists). */
  pictureUrl?: string | null
  /** The whole file. */
  markdown: string
}

/** Column colours: doing is amber (work in hand), to do is sky, done is slate. */
export const MISSION_COLUMN_COLOR: Record<MissionColumn, string> = { doing: '#fbbf24', 'to do': '#38bdf8', done: '#94a3b8' }

const COLUMN: Record<string, MissionColumn> = { idea: 'to do', agreed: 'to do', doing: 'doing', shipped: 'done', verified: 'done' }
const COLUMN_ORDER: Record<MissionColumn, number> = { doing: 0, 'to do': 1, done: 2 }

/** Inline markdown to plain words: links keep their text; bold, italics and code lose their marks. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstParagraph(lines: string[], from: number): string {
  const out: string[] = []
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) {
      if (out.length) break
      continue
    }
    if (line.startsWith('#') || line.startsWith('<!--') || line.startsWith('|')) {
      if (out.length) break
      continue
    }
    out.push(line.replace(/^([-*]|\d+\.)\s+/, ''))
  }
  return plainText(out.join(' '))
}

export function parseMission(file: string, text: string): Mission {
  const markdown = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = markdown.split('\n')
  const head: Record<string, string> = {}
  let bodyStart = 0
  for (; bodyStart < lines.length; bodyStart += 1) {
    const line = lines[bodyStart]
    if (!line.trim()) break
    const colon = line.indexOf(':')
    // A file with no header starts straight with its title or its text.
    if (colon < 0 || line.startsWith('#')) break
    head[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  const titleLine = lines.find(line => line.startsWith('# '))
  const title = titleLine ? titleLine.slice(2).trim() : file.replace(/\.md$/i, '')
  const nums: Record<string, number> = {}
  for (const match of (head.score || '').matchAll(/(ease|impact|urgency)\s*(\d)/g)) nums[match[1]] = Number(match[2])
  const complete = 'ease' in nums && 'impact' in nums && 'urgency' in nums
  const state = head.state || 'idea'
  const doneWhen = head['done when'] || ''
  return {
    file,
    title,
    state,
    column: COLUMN[state] || 'to do',
    who: head.who || '',
    doneWhen,
    ease: nums.ease ?? null,
    impact: nums.impact ?? null,
    urgency: nums.urgency ?? null,
    priority: complete ? Math.round((nums.ease * nums.impact * nums.urgency / 125) * 100) / 100 : null,
    tldr: plainText(doneWhen) || firstParagraph(lines, bodyStart),
    picture: head.picture || '',
    markdown,
  }
}

/** Doing first, then to do, then done; the highest priority first within each; ties by file name. */
export function rankMissions<T extends Pick<Mission, 'file' | 'column' | 'priority'>>(missions: T[]): T[] {
  return [...missions].sort((a, b) =>
    COLUMN_ORDER[a.column] - COLUMN_ORDER[b.column]
    || (b.priority || 0) - (a.priority || 0)
    || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

/** Picture files the wall shows. */
export function isMissionPicture(name: string): boolean {
  return /^[\w][\w.-]*\.(jpe?g|png|webp)$/i.test(name)
}

/**
 * The words a panel shows, huge, where a mission has no picture yet: the title without its small
 * words, at most three, so it reads from across the plaza.
 */
export function missionPosterWords(title: string): string[] {
  const small = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'my', 'as', 'with', 'over', 'is', 'gets'])
  const words = title.replace(/\([^)]*\)/g, ' ').split(/[^\p{L}\p{N}']+/u).filter(Boolean)
  const strong = words.filter(word => !small.has(word.toLowerCase()))
  return (strong.length ? strong : words).slice(0, 3).map(word => word.toUpperCase())
}

/** Is this a mission file? Every .md in the folder but the README. */
export function isMissionFile(name: string): boolean {
  return /\.md$/i.test(name) && name.toLowerCase() !== 'readme.md'
}

// ─── the wall ───────────────────────────────────────────────────────────────

/**
 * A panel, in meters: a frame that holds, top to bottom, the picture (16:9, what you recognise from
 * far away), the card with the numbers, and a caption plate with the TL;DR. The title stands on top
 * in 3D letters.
 */
export const MISSION_PANEL = {
  width: 1.9,
  pictureHeight: (1.9 * 9) / 16,
  cardHeight: 0.85,
  /** The frame's bars between the picture, the card and the caption. */
  gap: 0.06,
  captionHeight: 0.6,
  border: 0.07,
  depth: 0.07,
  /** The frame's lower edge above the ground. */
  bottomY: 0.72,
}
/** The printed face (picture + bar + card + bar + caption) inside the frame. */
export const MISSION_FACE = {
  width: MISSION_PANEL.width,
  height: MISSION_PANEL.pictureHeight + MISSION_PANEL.cardHeight + MISSION_PANEL.captionHeight + MISSION_PANEL.gap * 2,
  bottomY: MISSION_PANEL.bottomY + MISSION_PANEL.border,
}

export interface MissionAtlasGrid {
  cols: number
  rows: number
  /** One panel's face in the texture, in pixels. */
  tileWidth: number
  tileHeight: number
  width: number
  height: number
  pxPerMeter: number
}

/**
 * Every panel's face is printed into one texture (one draw call for the whole wall): a grid of
 * tiles, as sharp as `density` pixels per meter allows within `maxSize`.
 */
export function missionAtlasGrid(count: number, maxSize = 4096, density = 420): MissionAtlasGrid {
  const n = Math.max(1, Math.floor(count))
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const pxPerMeter = Math.floor(Math.min(density, maxSize / (cols * MISSION_FACE.width), maxSize / (rows * MISSION_FACE.height)))
  const tileWidth = Math.floor(MISSION_FACE.width * pxPerMeter)
  const tileHeight = Math.floor(MISSION_FACE.height * pxPerMeter)
  return { cols, rows, tileWidth, tileHeight, width: cols * tileWidth, height: rows * tileHeight, pxPerMeter }
}

/**
 * How big a panel stands: the top priority on the wall is the biggest, a mission with no score the
 * smallest. Scales the whole panel about its foot.
 */
export function missionPanelScale(priority: number | null, topPriority: number): number {
  const share = topPriority > 0 ? Math.min(1, Math.max(0, (priority || 0) / topPriority)) : 0
  return Math.round((0.72 + 0.43 * share) * 1000) / 1000
}

/** Tile `index`'s place in the texture, in pixels from the top left. */
export function missionAtlasTile(grid: MissionAtlasGrid, index: number): { x: number; y: number } {
  return { x: (index % grid.cols) * grid.tileWidth, y: Math.floor(index / grid.cols) * grid.tileHeight }
}

/** No more panels than this in the world: the highest ranked stay, done ones go first. */
export const MISSION_WALL_MAX = 24
/** Walk this close to a panel (ground distance to its foot) to read it. */
export const MISSION_READ_RADIUS = 2.3

const WALL = {
  /** Clear ground between the desk ring and the first arc (the helpers stand about 2.5 m behind a desk). */
  firstGap: 3.8,
  /** Between arcs: an aisle to walk. */
  rowGap: 3.3,
  /** Between neighbours on an arc, centre to centre: a 0.9 m gap to walk through. */
  spacing: 2.7,
  /** The widest an arc gets, in radians. */
  maxSpread: (110 * Math.PI) / 180,
  /** Each arc further back stands this much higher, so it shows over the one in front. */
  rowLift: 1.2,
  rows: 8,
}

export interface MissionWallInput {
  /** The plaza centre: arcs curve around it and panels face it. */
  center: { x: number; z: number }
  /** Anorak's desk; null: the plaza's far side (`fallbackYaw`, `fallbackRadius` from the centre). */
  anchor: { x: number; z: number } | null
  fallbackYaw?: number
  fallbackRadius?: number
  /** Every desk in the village: the arcs start behind the ones in their way. */
  desks?: Array<{ x: number; z: number }>
  max?: number
}

export interface MissionPanelLayout {
  file: string
  /** The panel's foot on the ground (y = 0; callers add terrain height). */
  position: Vec3
  /** Yaw so the panel's front (local +Z) faces the plaza. */
  rotationY: number
  /** Extra height for arcs further back. */
  lift: number
  row: number
  /** Done: the farthest arc, dimmed. */
  dimmed: boolean
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

/**
 * Arcs behind Anorak's desk, facing the plaza. Missions arrive ranked; the open ones take the free
 * places nearest to the desk, in order, so the closest panel is the top priority and the cluster
 * grows outward. Done ones stand on an arc of their own behind everything else.
 */
export function layoutMissionWall(
  missions: Array<Pick<Mission, 'file' | 'column'>>,
  input: MissionWallInput,
): MissionPanelLayout[] {
  const { center } = input
  const fallbackYaw = input.fallbackYaw ?? 0
  const fallbackRadius = input.fallbackRadius ?? 6.5
  const anchor = input.anchor || { x: center.x + Math.sin(fallbackYaw) * fallbackRadius, z: center.z + Math.cos(fallbackYaw) * fallbackRadius }
  const bearing = Math.atan2(anchor.x - center.x, anchor.z - center.z)
  const anchorRadius = Math.hypot(anchor.x - center.x, anchor.z - center.z)
  // Desks on wider rings, inside the wall's wedge, push the first arc behind them.
  let clear = anchorRadius
  for (const desk of input.desks || []) {
    const radius = Math.hypot(desk.x - center.x, desk.z - center.z)
    const off = Math.abs(angleDelta(Math.atan2(desk.x - center.x, desk.z - center.z), bearing))
    if (radius > clear && off <= WALL.maxSpread / 2 + 0.35) clear = radius
  }

  const max = Math.max(0, input.max ?? MISSION_WALL_MAX)
  const shown = missions.slice(0, max)
  const open = shown.filter(mission => mission.column !== 'done')
  const done = shown.filter(mission => mission.column === 'done')

  const place = (row: number, offset: number) => {
    const radius = clear + WALL.firstGap + row * WALL.rowGap
    const step = 2 * Math.asin(Math.min(1, WALL.spacing / 2 / radius))
    const angle = bearing + offset * step
    const x = center.x + Math.sin(angle) * radius
    const z = center.z + Math.cos(angle) * radius
    return { x, z, row, distance: Math.hypot(x - anchor.x, z - anchor.z) }
  }
  const rowSide = (row: number) => {
    const radius = clear + WALL.firstGap + row * WALL.rowGap
    const step = 2 * Math.asin(Math.min(1, WALL.spacing / 2 / radius))
    return Math.floor(WALL.maxSpread / 2 / step)
  }
  const panel = (file: string, spot: { x: number; z: number; row: number }, dimmed: boolean): MissionPanelLayout => ({
    file,
    position: [spot.x, 0, spot.z],
    rotationY: Math.atan2(center.x - spot.x, center.z - spot.z),
    lift: spot.row * WALL.rowLift,
    row: spot.row,
    dimmed,
  })

  const spots: Array<ReturnType<typeof place>> = []
  for (let row = 0; row < WALL.rows; row += 1) {
    const side = rowSide(row)
    for (let offset = -side; offset <= side; offset += 1) spots.push(place(row, offset))
  }
  // Nearest first; on a tie the nearer arc, then the left side.
  spots.sort((a, b) => a.distance - b.distance || a.row - b.row)

  const out: MissionPanelLayout[] = []
  let lastRow = -1
  open.forEach((mission, index) => {
    const spot = spots[index]
    if (!spot) return
    lastRow = Math.max(lastRow, spot.row)
    out.push(panel(mission.file, spot, false))
  })
  // Done: from the middle of the next arc outward (0, +1, -1 ...), spilling onto further arcs.
  let row = lastRow + 1
  let slot = 0
  for (const mission of done) {
    if (slot > rowSide(row) * 2) {
      row += 1
      slot = 0
    }
    const offset = slot % 2 === 1 ? (slot + 1) / 2 : -slot / 2
    out.push(panel(mission.file, place(row, offset), true))
    slot += 1
  }
  return out
}

// ─── text that fits ─────────────────────────────────────────────────────────

/** Break `text` into at most `maxLines` lines no wider than `maxWidth`; what doesn't fit ends in "…". */
export function wrapByWidth(text: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i += 1) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (!line || measure(next) <= maxWidth) {
      line = next
      continue
    }
    if (lines.length === maxLines - 1) {
      // The last line: cut words until the ellipsis fits.
      let cut = line
      while (cut.includes(' ') && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, cut.lastIndexOf(' '))
      lines.push(`${cut}…`)
      return lines
    }
    lines.push(line)
    line = words[i]
  }
  if (line) lines.push(line)
  return lines
}

/** A TL;DR short enough to print under a card: whole words, then "…". */
export function clampWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars + 1)
  const space = cut.lastIndexOf(' ')
  return `${cut.slice(0, space > maxChars * 0.6 ? space : maxChars).replace(/[\s,;:.]+$/, '')}…`
}

// ─── keys ───────────────────────────────────────────────────────────────────

export type MissionKeyAction = 'read' | 'full' | 'toggle-full' | 'close'

export interface MissionKeyContext {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  repeat: boolean
  /** The key went into a text field. */
  typing: boolean
  /** The reader is open: beside the world, or over all of it. */
  reader: 'side' | 'full' | null
  /** A panel is within reach. */
  nearby: boolean
  /** An agent is open or within reach: its keys win. */
  agent: boolean
  /** Walking around (not placing, painting or typing in another panel). */
  worldKeysFree: boolean
}

/** Next to a panel: E reads it beside the world, F over the whole screen. Reading: F switches, Esc (or E) closes. */
export function missionKeyAction(c: MissionKeyContext): MissionKeyAction | null {
  // Esc leaves the reader from a text field too (the reader first drops an edit in progress).
  if (c.reader && c.code === 'Escape' && !c.ctrl && !c.meta && !c.alt && !c.repeat) return 'close'
  if (c.ctrl || c.meta || c.alt || c.repeat || c.typing) return null
  if (c.reader) {
    if (c.code === 'KeyF') return 'toggle-full'
    if (c.code === 'KeyE') return 'close'
    return null
  }
  if (c.agent || !c.nearby || !c.worldKeysFree) return null
  if (c.code === 'KeyE') return 'read'
  if (c.code === 'KeyF') return 'full'
  return null
}
