// ░▒▓ ACADEMY SKILL MAP ENGINE — draws the skill map on its own small WebGL canvas ▓▒░
// Plain three.js, no React: VillageAcademyMap.tsx creates one when the map opens and disposes it when
// it closes, so a closed map costs nothing. One render pass of five draw calls whatever the number of
// skills: stars, ring guides, lines (instanced), glows (instanced), and every node with its label and
// every lane name as instanced quads cut from one printed texture. Pulses, the flow along lit lines
// and the hover response run in the shaders from one time uniform; the CPU only eases the view and a
// handful of per-node numbers.

import * as THREE from 'three'
import { ACADEMY_KEY_COLOR, type AcademyIconPart, type AcademyKeyKind, type AcademyNodeLook } from '../../lib/village/village-academy'
import type { KeyState } from '../../lib/village/keychain'
import {
  clampMapView,
  fitMapView,
  openMapView,
  pickMapNode,
  zoomMapView,
  type AcademyMapLayout,
  type AcademyMapPattern,
  type AcademyMapView,
} from '../../lib/village/academy-map'

export interface MapNodeSpec {
  id: string
  /** The label under the face. */
  name: string
  order: number
  xp: number
  color: string
  corners: number
  pattern: AcademyMapPattern
  icon: AcademyIconPart[] | null
  /** Each key the skill lists, and whether it is held: a held key's gem is lit. */
  keys: Array<{ kind: AcademyKeyKind; state: KeyState }>
  perk: boolean
  flag: boolean
  look: AcademyNodeLook
}

export interface MapEngineHandlers {
  onHover: (id: string | null) => void
  onPick: (id: string) => void
}

// Board units.
const FACE = 1.5
const LABEL = { width: 2.5, height: 0.7, gap: 0.1 }
const TILE = { width: LABEL.width, height: FACE + LABEL.gap + LABEL.height }
/** From the node's centre (the face's centre) to the tile's centre. */
const TILE_OFFSET_Y = FACE / 2 - TILE.height / 2
const FONT = 'Bahnschrift, "Barlow Condensed", "Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const LOCKED_SCALE = 0.84
const HOVER_SCALE = 1.16
const FOV = 30
const FLASH_MS = 1700
const LANE_NAME_SCALE = 2.1
/** Zoomed out, a node never gets smaller on screen than this many pixels per board unit would make it. */
const MIN_NODE_PX = 25
const MAX_ZOOM_GROW = 1.4
const STATE_WORD: Record<AcademyNodeLook, string> = { locked: 'LOCKED', available: 'READY', claimed: 'CLAIMED', verified: 'VERIFIED' }

// ─── printing ───────────────────────────────────────────────────────────────

function shapePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, corners: number): void {
  ctx.beginPath()
  if (corners < 3) {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    return
  }
  // A little bigger than the circle it replaces, so every shape weighs the same; flat side down for even counts.
  const r = radius * (corners === 4 ? 1.12 : 1.06)
  const start = -Math.PI / 2 + (corners % 2 === 0 && corners !== 4 ? Math.PI / corners : 0)
  for (let i = 0; i < corners; i += 1) {
    const angle = start + (i * 2 * Math.PI) / corners
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function drawPattern(ctx: CanvasRenderingContext2D, pattern: AcademyMapPattern, cx: number, cy: number, radius: number): void {
  const r = radius
  ctx.lineWidth = Math.max(1, r * 0.035)
  ctx.beginPath()
  switch (pattern) {
    case 'rings':
      for (let k = 1; k <= 4; k += 1) { ctx.moveTo(cx + (r * k) / 4.4, cy); ctx.arc(cx, cy, (r * k) / 4.4, 0, Math.PI * 2) }
      break
    case 'rays':
      for (let k = 0; k < 16; k += 1) {
        const a = (k * Math.PI) / 8
        ctx.moveTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55)
        ctx.lineTo(cx + Math.cos(a) * r * 1.1, cy + Math.sin(a) * r * 1.1)
      }
      break
    case 'dots':
      for (let x = -4; x <= 4; x += 1) for (let y = -4; y <= 4; y += 1) {
        const px = cx + (x + (y % 2 ? 0.5 : 0)) * r * 0.27
        const py = cy + y * r * 0.24
        ctx.moveTo(px + r * 0.035, py)
        ctx.arc(px, py, r * 0.035, 0, Math.PI * 2)
      }
      break
    case 'stripes':
      for (let k = -8; k <= 8; k += 1) { ctx.moveTo(cx + k * r * 0.22 - r, cy + r); ctx.lineTo(cx + k * r * 0.22 + r, cy - r) }
      break
    case 'cells':
      for (let k = -4; k <= 4; k += 1) {
        ctx.moveTo(cx + k * r * 0.3, cy - r); ctx.lineTo(cx + k * r * 0.3, cy + r)
        ctx.moveTo(cx - r, cy + k * r * 0.3); ctx.lineTo(cx + r, cy + k * r * 0.3)
      }
      break
    case 'waves':
      for (let k = -4; k <= 4; k += 1) {
        const y = cy + k * r * 0.26
        ctx.moveTo(cx - r, y)
        for (let x = -r; x <= r; x += r / 10) ctx.lineTo(cx + x, y + Math.sin((x / r) * Math.PI * 3) * r * 0.07)
      }
      break
    case 'chevrons':
      for (let k = -4; k <= 5; k += 1) {
        const y = cy + k * r * 0.27
        ctx.moveTo(cx - r, y); ctx.lineTo(cx, y - r * 0.3); ctx.lineTo(cx + r, y)
      }
      break
  }
  ctx.stroke()
}

function drawIcon(ctx: CanvasRenderingContext2D, icon: AcademyIconPart[], cx: number, cy: number, size: number, color: string, under: string | null): void {
  const scale = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(scale, scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const paint = (stroke: string, width: number) => {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    for (const [kind, attrs] of icon) {
      try {
        if (kind === 'path' && attrs.d) ctx.stroke(new Path2D(attrs.d))
        else if (kind === 'circle') { ctx.beginPath(); ctx.arc(Number(attrs.cx), Number(attrs.cy), Number(attrs.r), 0, Math.PI * 2); ctx.stroke() }
        else if (kind === 'rect') {
          const x = Number(attrs.x), y = Number(attrs.y), w = Number(attrs.width), h = Number(attrs.height), rx = Math.min(Number(attrs.rx) || 0, w / 2, h / 2)
          ctx.beginPath()
          ctx.moveTo(x + rx, y); ctx.arcTo(x + w, y, x + w, y + h, rx); ctx.arcTo(x + w, y + h, x, y + h, rx); ctx.arcTo(x, y + h, x, y, rx); ctx.arcTo(x, y, x + w, y, rx)
          ctx.closePath(); ctx.stroke()
        }
      } catch { /* a path the browser cannot read: skip that shape */ }
    }
  }
  if (under) paint(under, 4.4)
  paint(color, 1.9)
  ctx.restore()
}

function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number): void {
  ctx.font = `${weight} ${size}px ${FONT}`
  const width = ctx.measureText(text).width
  if (width > maxWidth) ctx.font = `${weight} ${Math.floor((size * maxWidth) / width)}px ${FONT}`
}

/** One node's tile at (x, y): the face in its lane's shape and pattern, then the label with its key gems. `u`: pixels per board unit. */
function drawNodeTile(ctx: CanvasRenderingContext2D, node: MapNodeSpec, x: number, y: number, u: number): void {
  const w = TILE.width * u
  const face = FACE * u
  const cx = x + w / 2
  const cy = y + face / 2
  const radius = face * 0.43
  const { look, color } = node
  const locked = look === 'locked'
  ctx.clearRect(x, y, w, TILE.height * u)

  ctx.save()
  shapePath(ctx, cx, cy, radius, node.corners)
  ctx.clip()
  ctx.fillStyle = locked ? '#141926' : '#0b1020'
  ctx.fillRect(cx - face / 2, cy - face / 2, face, face)
  if (look === 'verified' || look === 'claimed') {
    const top = look === 'verified' ? cy - face / 2 : cy + radius * 0.08
    const fill = ctx.createRadialGradient(cx, cy - radius * 0.35, radius * 0.1, cx, cy, radius * 1.25)
    fill.addColorStop(0, '#ffffff')
    fill.addColorStop(0.42, color)
    fill.addColorStop(1, color)
    ctx.fillStyle = fill
    ctx.fillRect(cx - face / 2, top, face, cy + face / 2 - top)
  }
  // The lane's own texture: faint on a dark face, a shade darker on a lit one.
  ctx.globalAlpha = locked ? 0.1 : look === 'verified' ? 0.16 : 0.2
  ctx.strokeStyle = look === 'verified' ? '#04101c' : locked ? '#94a3b8' : color
  drawPattern(ctx, node.pattern, cx, cy, radius)
  ctx.globalAlpha = 1
  ctx.restore()

  // The frame: dashed for an optional side skill, doubled for a flagship.
  shapePath(ctx, cx, cy, radius, node.corners)
  ctx.lineWidth = face * 0.045
  ctx.strokeStyle = locked ? '#3a4252' : look === 'verified' ? '#ffffff' : color
  if (node.perk) ctx.setLineDash([face * 0.07, face * 0.05])
  ctx.stroke()
  ctx.setLineDash([])
  if (node.flag) {
    shapePath(ctx, cx, cy, radius + face * 0.055, node.corners)
    ctx.lineWidth = face * 0.018
    ctx.stroke()
  }

  const ink = locked ? '#5b6474' : look === 'available' ? color : look === 'claimed' ? '#ffffff' : '#06121f'
  if (node.icon?.length) drawIcon(ctx, node.icon, cx, cy, face * 0.46, ink, look === 'claimed' ? '#0b1020' : null)
  else {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${Math.round(face * 0.4)}px ${FONT}`
    if (look === 'claimed') { ctx.lineWidth = face * 0.06; ctx.strokeStyle = '#0b1020'; ctx.strokeText(String(node.order), cx, cy + face * 0.02) }
    ctx.fillStyle = ink
    ctx.fillText(String(node.order), cx, cy + face * 0.02)
  }

  // The label.
  const lh = LABEL.height * u
  const ly = y + (FACE + LABEL.gap) * u
  const pad = Math.max(2, u * 0.03)
  const r = lh * 0.28
  ctx.beginPath()
  ctx.moveTo(x + pad + r, ly + pad)
  ctx.arcTo(x + w - pad, ly + pad, x + w - pad, ly + lh - pad, r)
  ctx.arcTo(x + w - pad, ly + lh - pad, x + pad, ly + lh - pad, r)
  ctx.arcTo(x + pad, ly + lh - pad, x + pad, ly + pad, r)
  ctx.arcTo(x + pad, ly + pad, x + w - pad, ly + pad, r)
  ctx.closePath()
  ctx.fillStyle = locked ? 'rgba(17,21,30,0.86)' : 'rgba(8,12,24,0.92)'
  ctx.fill()
  ctx.lineWidth = Math.max(1.5, u * 0.022)
  ctx.strokeStyle = locked ? '#343c4c' : color
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const name = node.name.toUpperCase()
  fit(ctx, name, 700, Math.round(lh * 0.45), w - u * 0.26)
  ctx.fillStyle = locked ? '#8891a3' : '#f8fafc'
  ctx.fillText(name, cx, ly + lh * 0.37)
  ctx.font = `600 ${Math.round(lh * 0.24)}px ${FONT}`
  ctx.fillStyle = locked ? '#667085' : color
  const xp = node.xp ? `  ·  ${look === 'available' ? '+' : ''}${node.xp} XP` : ''
  ctx.fillText(`${STATE_WORD[look]}${look === 'verified' ? ' ✓' : ''}${xp}`, cx, ly + lh * 0.76)

  // Its keys: gems on the label's upper edge (subscriptions gold, API keys blue).
  const gems = node.keys.slice(0, 8)
  const gemR = u * 0.075
  gems.forEach(({ kind, state }, index) => {
    const gx = cx + (index - (gems.length - 1) / 2) * gemR * 2.5
    const gy = ly + pad
    const color = ACADEMY_KEY_COLOR[kind]
    if (state === 'have') {
      // A key you hold: lit, with a halo and a white rim.
      const halo = ctx.createRadialGradient(gx, gy, gemR * 0.4, gx, gy, gemR * 2.6)
      halo.addColorStop(0, `${color}cc`)
      halo.addColorStop(1, `${color}00`)
      ctx.fillStyle = halo
      ctx.fillRect(gx - gemR * 2.6, gy - gemR * 2.6, gemR * 5.2, gemR * 5.2)
    }
    ctx.beginPath()
    ctx.arc(gx, gy, state === 'have' ? gemR * 1.12 : gemR, 0, Math.PI * 2)
    // Missing: a dim outline only. Unknown: as it was before the keychain knew.
    ctx.fillStyle = state === 'missing' ? '#0b1020' : color
    ctx.globalAlpha = state === 'have' ? 1 : state === 'missing' ? 0.9 : locked ? 0.55 : 0.85
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = Math.max(1, u * (state === 'have' ? 0.024 : 0.014))
    ctx.strokeStyle = state === 'have' ? '#ffffff' : state === 'missing' ? `${color}88` : '#05070d'
    ctx.stroke()
  })
}

function drawLaneTile(ctx: CanvasRenderingContext2D, name: string, color: string, x: number, y: number, u: number): void {
  const w = TILE.width * u
  const h = TILE.height * u
  ctx.clearRect(x, y, w, h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = name.toUpperCase()
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(u * 0.06)}px` } catch { /* older browsers */ }
  fit(ctx, text, 700, Math.round(h * 0.3), w - u * 0.2)
  ctx.fillStyle = color
  ctx.globalAlpha = 0.9
  ctx.fillText(text, x + w / 2, y + h / 2)
  ctx.globalAlpha = 1
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px' } catch { /* older browsers */ }
}

/** What a node's tile shows: when this changes, the tile is printed again. */
function tileSignature(spec: MapNodeSpec): string {
  return `${spec.look}|${spec.keys.map(key => key.state[0]).join('')}`
}

// ─── shaders ────────────────────────────────────────────────────────────────

const TILE_VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute vec4 aRect;
  attribute float aScale;
  attribute float aBright;
  varying vec2 vUv;
  varying float vBright;
  uniform vec2 uTile;
  uniform float uOffsetY;
  uniform float uZoom;
  void main() {
    vUv = aRect.xy + uv * aRect.zw;
    vBright = aBright;
    // A negative scale marks a lane's name: it keeps its size on the board.
    float size = aScale < 0.0 ? -aScale : aScale * uZoom;
    vec3 p = aPos + vec3((position.xy * uTile + vec2(0.0, uOffsetY)) * size, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`
const TILE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uFade;
  varying vec2 vUv;
  varying float vBright;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.01) discard;
    gl_FragColor = vec4(c.rgb * vBright, c.a * uFade);
    #include <colorspace_fragment>
  }
`
const GLOW_VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute vec3 aColor;
  attribute vec4 aGlow; // size, steady, pulse, boost
  varying vec2 vUv;
  varying vec3 vColor;
  uniform float uTime;
  uniform float uZoom;
  void main() {
    vUv = uv;
    float wave = 0.5 + 0.5 * sin(uTime * 3.2 + aPos.x * 0.7 + aPos.y * 0.9);
    float strength = aGlow.y + aGlow.z * wave + aGlow.w;
    vColor = aColor * strength;
    float size = aGlow.x * uZoom * (1.0 + 0.12 * aGlow.z * wave + 0.5 * min(aGlow.w, 2.0));
    vec3 p = aPos + vec3(position.xy * size, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`
const GLOW_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  uniform float uFade;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    vec3 c = vColor * a * a * uFade;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`
const LINE_VERTEX = /* glsl */ `
  attribute vec4 aEnds;  // from.xy, to.xy
  attribute vec4 aColor; // rgb, strength
  attribute float aWidth;
  varying vec2 vAt;
  varying vec4 vColor;
  varying float vLength;
  void main() {
    vec2 a = aEnds.xy;
    vec2 b = aEnds.zw;
    vec2 along = b - a;
    vLength = length(along);
    vec2 normal = vLength > 0.0001 ? vec2(-along.y, along.x) / vLength : vec2(0.0, 1.0);
    vAt = vec2(position.x + 0.5, position.y * 2.0);
    vColor = aColor;
    vec2 p = a + along * (position.x + 0.5) + normal * position.y * aWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, -0.12, 1.0);
  }
`
const LINE_FRAGMENT = /* glsl */ `
  varying vec2 vAt;
  varying vec4 vColor;
  varying float vLength;
  uniform float uTime;
  uniform float uFade;
  void main() {
    float edge = 1.0 - smoothstep(0.35, 1.0, abs(vAt.y));
    // Lit lines carry a slow light from what is done to what it opens.
    float flow = 0.72 + 0.28 * sin(vAt.x * vLength * 2.4 - uTime * 2.6);
    float strength = vColor.a > 0.5 ? vColor.a * flow : vColor.a;
    gl_FragColor = vec4(vColor.rgb, edge * strength * uFade);
    #include <colorspace_fragment>
  }
`

// ─── the engine ─────────────────────────────────────────────────────────────

const LOOK_BRIGHT: Record<AcademyNodeLook, number> = { locked: 0.8, available: 1, claimed: 1, verified: 1.08 }
/** size, steady, pulse */
const LOOK_GLOW: Record<AcademyNodeLook, [number, number, number]> = { locked: [0, 0, 0], available: [2.5, 0.1, 0.34], claimed: [2.6, 0.3, 0], verified: [3.3, 0.72, 0] }

export class AcademyMapEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000)
  private canvas: HTMLCanvasElement
  private handlers: MapEngineHandlers
  private raf = 0
  private disposed = false
  private startedAt = performance.now()
  private lastFrame = performance.now()
  private frame = 0
  private size = { width: 1, height: 1 }

  private layout: AcademyMapLayout | null = null
  private specs: MapNodeSpec[] = []
  private indexOf = new Map<string, number>()
  private looksKey = ''
  private flashKey = ''
  private flashes = new Map<number, number>()
  /** The look each node's tile was last printed with. */
  private printed: string[] = []

  private atlas: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; cols: number; u: number; tileW: number; tileH: number } | null = null
  private tiles: THREE.Mesh | null = null
  private glows: THREE.Mesh | null = null
  private lines: THREE.Mesh | null = null
  private guides: THREE.LineSegments | null = null
  private stars: THREE.Points | null = null
  private uniforms = { uTime: { value: 0 }, uFade: { value: 0 }, uZoom: { value: 1 } }

  private view: AcademyMapView = { x: 0, y: 0, span: 40 }
  private goal: AcademyMapView = { x: 0, y: 0, span: 40 }
  private parallax = { x: 0, y: 0, goalX: 0, goalY: 0 }
  private drag: { id: number; x: number; y: number; moved: boolean; at: number } | null = null
  private velocity = { x: 0, y: 0 }
  private hovered: string | null = null
  private selected: string | null = null
  private scales: Float32Array = new Float32Array(0)
  private scaleGoals: Float32Array = new Float32Array(0)
  private busyUntil = 0
  /** For measurements: frames drawn and the time spent drawing them. */
  stats = { frames: 0, ms: 0 }

  constructor(canvas: HTMLCanvasElement, handlers: MapEngineHandlers) {
    this.canvas = canvas
    this.handlers = handlers
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('dblclick', this.onDoubleClick)
    this.raf = requestAnimationFrame(this.tick)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const canvas = this.canvas
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerUp)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('wheel', this.onWheel)
    canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.clearBoard()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  resize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) }
    this.renderer.setSize(this.size.width, this.size.height, false)
    this.camera.aspect = this.size.width / this.size.height
    this.camera.updateProjectionMatrix()
    this.wake()
  }

  /** The whole board in view. */
  fit(): void {
    if (this.layout) this.goal = fitMapView(this.layout.radius)
    this.wake()
  }

  zoomBy(delta: number): void {
    if (this.layout) this.goal = zoomMapView(this.goal, delta, 0, 0, this.layout.radius)
    this.wake()
  }

  /** The node whose sheet is open: it stays raised. */
  setSelected(id: string | null): void {
    if (id === this.selected) return
    this.selected = id
    this.applyScaleGoals()
  }

  getView(): AcademyMapView {
    return { ...this.view }
  }

  /** Where a node is on the canvas, in CSS pixels (playtests click there). */
  screenOf(id: string): { x: number; y: number } | null {
    const node = this.layout?.nodes.find(item => item.id === id)
    if (!node) return null
    const point = new THREE.Vector3(node.x, node.y, 0).project(this.camera)
    return { x: ((point.x + 1) / 2) * this.size.width, y: ((1 - point.y) / 2) * this.size.height }
  }

  /**
   * The board and everyone's looks. A new layout (another set of skills) rebuilds everything and fits the
   * view; new looks only reprint the texture and reset the glows. `flashKey`: whose progress this is; a
   * node that lights up for the same trainee flashes.
   */
  setBoard(layout: AcademyMapLayout, specs: MapNodeSpec[], flashKey: string): void {
    const looksKey = specs.map(tileSignature).join(',')
    if (layout !== this.layout) {
      this.clearBoard()
      this.layout = layout
      this.specs = specs
      this.indexOf = new Map(layout.nodes.map((node, index) => [node.id, index]))
      this.build()
      const opening = openMapView(layout.radius)
      // Arrive from a little further out.
      this.view = { ...opening, span: opening.span * 1.25 }
      this.goal = opening
      this.flashes.clear()
    } else {
      const before = this.specs
      this.specs = specs
      if (looksKey !== this.looksKey) {
        if (flashKey === this.flashKey) {
          const now = performance.now()
          const was = new Map(before.map(spec => [spec.id, spec.look]))
          for (const spec of specs) {
            const index = this.indexOf.get(spec.id)
            if (index !== undefined && was.get(spec.id) !== spec.look && (spec.look === 'verified' || spec.look === 'claimed')) this.flashes.set(index, now)
          }
        }
        this.print()
        this.applyLooks()
      }
    }
    this.looksKey = looksKey
    this.flashKey = flashKey
    this.wake()
  }

  // ── building ──

  private clearBoard(): void {
    for (const object of [this.tiles, this.glows, this.lines, this.guides, this.stars]) {
      if (!object) continue
      this.scene.remove(object)
      object.geometry.dispose()
      ;(object.material as THREE.Material).dispose()
    }
    this.tiles = this.glows = this.lines = null
    this.guides = null
    this.stars = null
    this.atlas?.texture.dispose()
    this.atlas = null
    this.printed = []
  }

  private specOf(id: string): MapNodeSpec | undefined {
    return this.specs.find(spec => spec.id === id)
  }

  private build(): void {
    const layout = this.layout
    if (!layout) return
    const count = layout.nodes.length
    const laneCount = layout.lanes.length
    const max = Math.min(4096, this.renderer.capabilities.maxTextureSize)

    // The texture: as sharp as fits.
    const tiles = count + laneCount
    let u = 48
    let cols = 1
    // ...and no bigger than about 8 million pixels: it is printed and uploaded when a skill changes.
    for (const candidate of [176, 144, 128, 112, 96, 80, 64, 48]) {
      const tileW = Math.ceil(TILE.width * candidate) + 4
      const tileH = Math.ceil(TILE.height * candidate) + 4
      cols = Math.max(1, Math.floor(max / tileW))
      u = candidate
      const rows = Math.ceil(tiles / cols)
      if (rows * tileH <= max && Math.min(cols, tiles) * tileW * rows * tileH <= 8_400_000) break
    }
    const tileW = Math.ceil(TILE.width * u) + 4
    const tileH = Math.ceil(TILE.height * u) + 4
    cols = Math.min(cols, tiles)
    const canvas = document.createElement('canvas')
    canvas.width = cols * tileW
    canvas.height = Math.ceil(tiles / cols) * tileH
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.atlas = { canvas, texture, cols, u, tileW, tileH }

    const quad = new THREE.PlaneGeometry(1, 1)
    const instanced = (n: number) => {
      const geometry = new THREE.InstancedBufferGeometry()
      geometry.index = quad.index
      geometry.setAttribute('position', quad.getAttribute('position'))
      geometry.setAttribute('uv', quad.getAttribute('uv'))
      geometry.instanceCount = n
      return geometry
    }

    // Lines.
    const edges = layout.edges
    const lineGeometry = instanced(edges.length)
    lineGeometry.setAttribute('aEnds', new THREE.InstancedBufferAttribute(new Float32Array(edges.length * 4), 4))
    lineGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(edges.length * 4), 4))
    lineGeometry.setAttribute('aWidth', new THREE.InstancedBufferAttribute(new Float32Array(edges.length), 1))
    const at = new Map(layout.nodes.map(node => [node.id, node]))
    edges.forEach((edge, index) => {
      const a = at.get(edge.from)
      const b = at.get(edge.to)
      if (a && b) (lineGeometry.getAttribute('aEnds') as THREE.InstancedBufferAttribute).setXYZW(index, a.x, a.y, b.x, b.y)
    })
    this.lines = new THREE.Mesh(lineGeometry, new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT, uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false,
    }))
    this.lines.renderOrder = 2

    // Glows.
    const glowGeometry = instanced(count)
    glowGeometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3))
    glowGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3))
    glowGeometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4))
    this.glows = new THREE.Mesh(glowGeometry, new THREE.ShaderMaterial({
      vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    }))
    this.glows.renderOrder = 3

    // Nodes and lane names.
    const tileGeometry = instanced(tiles)
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(tiles * 3), 3)
    const rect = new THREE.InstancedBufferAttribute(new Float32Array(tiles * 4), 4)
    const scale = new THREE.InstancedBufferAttribute(new Float32Array(tiles), 1)
    const bright = new THREE.InstancedBufferAttribute(new Float32Array(tiles), 1)
    for (let index = 0; index < tiles; index += 1) {
      const tx = (index % cols) * tileW + 2
      const ty = Math.floor(index / cols) * tileH + 2
      rect.setXYZW(index, tx / canvas.width, 1 - (ty + TILE.height * u) / canvas.height, (TILE.width * u) / canvas.width, (TILE.height * u) / canvas.height)
      scale.setX(index, 1)
      bright.setX(index, 1)
    }
    layout.lanes.forEach((lane, index) => {
      // A lane name is a tile too: centred on its place (undo the node tile's offset), a little bigger.
      pos.setXYZ(count + index, lane.x, lane.y - TILE_OFFSET_Y * LANE_NAME_SCALE, 0)
      scale.setX(count + index, -LANE_NAME_SCALE)
    })
    tileGeometry.setAttribute('aPos', pos)
    tileGeometry.setAttribute('aRect', rect)
    tileGeometry.setAttribute('aScale', scale)
    tileGeometry.setAttribute('aBright', bright)
    this.tiles = new THREE.Mesh(tileGeometry, new THREE.ShaderMaterial({
      vertexShader: TILE_VERTEX, fragmentShader: TILE_FRAGMENT, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { ...this.uniforms, uMap: { value: texture }, uTile: { value: new THREE.Vector2(TILE.width, TILE.height) }, uOffsetY: { value: TILE_OFFSET_Y } },
    }))
    this.tiles.renderOrder = 4
    this.scales = new Float32Array(count).fill(1)
    this.scaleGoals = new Float32Array(count).fill(1)

    // Ring guides: one circle per tier.
    const ringPoints: number[] = []
    for (const radius of layout.rings) {
      if (radius <= 0) continue
      const steps = 96
      for (let k = 0; k < steps; k += 1) {
        const a = (k * 2 * Math.PI) / steps
        const b = ((k + 1) * 2 * Math.PI) / steps
        ringPoints.push(Math.cos(a) * radius, Math.sin(a) * radius, -0.3, Math.cos(b) * radius, Math.sin(b) * radius, -0.3)
      }
    }
    const guideGeometry = new THREE.BufferGeometry()
    guideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ringPoints, 3))
    this.guides = new THREE.LineSegments(guideGeometry, new THREE.LineBasicMaterial({ color: 0x8aa0c8, transparent: true, opacity: 0.1, depthTest: false }))
    this.guides.renderOrder = 1

    // Stars far behind the board: they move less than it does, which is the depth you feel when you drag.
    const starCount = 420
    const starPositions = new Float32Array(starCount * 3)
    let seed = 7
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let k = 0; k < starCount; k += 1) {
      const radius = Math.sqrt(random()) * layout.radius * 2.6
      const angle = random() * Math.PI * 2
      starPositions.set([Math.cos(angle) * radius, Math.sin(angle) * radius, -18 - random() * 60], k * 3)
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xbcd0ff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.55, depthTest: false }))
    this.stars.renderOrder = 0

    for (const object of [this.stars, this.guides, this.lines, this.glows, this.tiles]) {
      object.frustumCulled = false
      this.scene.add(object)
    }
    quad.dispose()
    this.print()
    this.applyLooks()
    // The page's display font may arrive after the first print.
    const wanted = `700 32px ${FONT}`
    try {
      if (document.fonts?.check && !document.fonts.check(wanted)) void document.fonts.load(wanted).then(() => { if (!this.disposed && this.layout === layout) { this.print(true); this.wake() } }).catch(() => {})
    } catch { /* unknown family: print with what there is */ }
  }

  private print(all_ = false): void {
    const atlas = this.atlas
    const layout = this.layout
    if (!atlas || !layout) return
    const ctx = atlas.canvas.getContext('2d')
    if (!ctx) return
    const place = (index: number) => ({ x: (index % atlas.cols) * atlas.tileW + 2, y: Math.floor(index / atlas.cols) * atlas.tileH + 2 })
    // Only what changed is drawn again: one skill lighting up is one tile.
    const all = this.printed.length !== layout.nodes.length || all_
    layout.nodes.forEach((node, index) => {
      const spec = this.specOf(node.id)
      if (!spec || (!all && this.printed[index] === tileSignature(spec))) return
      const { x, y } = place(index)
      drawNodeTile(ctx, spec, x, y, atlas.u)
      this.printed[index] = tileSignature(spec)
    })
    if (all) layout.lanes.forEach((lane, index) => {
      const { x, y } = place(layout.nodes.length + index)
      const color = this.specs.find(spec => layout.nodes.find(node => node.id === spec.id)?.lane === lane.id)?.color || '#94a3b8'
      drawLaneTile(ctx, lane.name, color, x, y, atlas.u)
    })
    atlas.texture.needsUpdate = true
  }

  /** Positions, glows, line colours and resting sizes from the looks. */
  private applyLooks(): void {
    const layout = this.layout
    if (!layout || !this.tiles || !this.glows || !this.lines) return
    const pos = this.tiles.geometry.getAttribute('aPos') as THREE.InstancedBufferAttribute
    const bright = this.tiles.geometry.getAttribute('aBright') as THREE.InstancedBufferAttribute
    const glowPos = this.glows.geometry.getAttribute('aPos') as THREE.InstancedBufferAttribute
    const glowColor = this.glows.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute
    const glow = this.glows.geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute
    const color = new THREE.Color()
    layout.nodes.forEach((node, index) => {
      const spec = this.specOf(node.id)
      const look = spec?.look || 'locked'
      // What is done stands a little nearer: it slides more when the view tilts.
      const z = look === 'verified' ? 0.45 : look === 'claimed' ? 0.25 : 0
      pos.setXYZ(index, node.x, node.y, z)
      bright.setX(index, LOOK_BRIGHT[look])
      glowPos.setXYZ(index, node.x, node.y, z - 0.05)
      // The glow shader writes its colour as it is (no conversion): hand it the colour as the screen means it.
      color.set(spec?.color || '#94a3b8').convertLinearToSRGB()
      glowColor.setXYZ(index, color.r, color.g, color.b)
      const [size, steady, pulse] = LOOK_GLOW[look]
      glow.setXYZW(index, size, steady, pulse, 0)
    })
    pos.needsUpdate = bright.needsUpdate = glowPos.needsUpdate = glowColor.needsUpdate = glow.needsUpdate = true
    this.applyLines()
    this.applyScaleGoals()
  }

  private applyLines(): void {
    const layout = this.layout
    if (!layout || !this.lines) return
    const colors = this.lines.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute
    const widths = this.lines.geometry.getAttribute('aWidth') as THREE.InstancedBufferAttribute
    const color = new THREE.Color()
    layout.edges.forEach((edge, index) => {
      const from = this.specOf(edge.from)
      const to = this.specOf(edge.to)
      const touched = this.hovered !== null && (edge.from === this.hovered || edge.to === this.hovered)
      const done = from?.look === 'verified' ? 1 : from?.look === 'claimed' ? 0.62 : 0
      if (done > 0 && to && to.look !== 'locked') {
        color.set(to.color)
        colors.setXYZW(index, color.r, color.g, color.b, Math.min(1, done + (touched ? 0.3 : 0)))
        widths.setX(index, edge.kind === 'need' ? 0.16 : 0.11)
      } else {
        color.set(touched ? (to?.color || '#cbd5e1') : edge.kind === 'need' ? '#7486a8' : '#56627a')
        colors.setXYZW(index, color.r, color.g, color.b, touched ? 0.5 : edge.kind === 'need' ? 0.3 : 0.16)
        widths.setX(index, edge.kind === 'need' ? 0.1 : 0.07)
      }
    })
    colors.needsUpdate = widths.needsUpdate = true
    this.wake()
  }

  private applyScaleGoals(): void {
    const layout = this.layout
    if (!layout) return
    layout.nodes.forEach((node, index) => {
      const look = this.specOf(node.id)?.look || 'locked'
      const rest = look === 'locked' ? LOCKED_SCALE : 1
      this.scaleGoals[index] = node.id === this.hovered || node.id === this.selected ? rest * HOVER_SCALE : rest
    })
    this.wake()
  }

  // ── pointer ──

  private wake(ms = 900): void {
    this.busyUntil = Math.max(this.busyUntil, performance.now() + ms)
  }

  /** The board point under a canvas point. */
  private boardAt(clientX: number, clientY: number): { x: number; y: number; nx: number; ny: number } {
    const bounds = this.canvas.getBoundingClientRect()
    const nx = ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1
    const ny = 1 - ((clientY - bounds.top) / Math.max(1, bounds.height)) * 2
    const far = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera)
    const origin = this.camera.position
    const dz = far.z - origin.z
    const t = Math.abs(dz) > 1e-6 ? -origin.z / dz : 0
    return { x: origin.x + (far.x - origin.x) * t, y: origin.y + (far.y - origin.y) * t, nx, ny }
  }

  private setHover(id: string | null): void {
    if (id === this.hovered) return
    this.hovered = id
    this.canvas.style.cursor = id ? 'pointer' : this.drag ? 'grabbing' : 'grab'
    this.applyScaleGoals()
    this.applyLines()
    this.handlers.onHover(id)
  }

  private onPointerDown = (event: PointerEvent): void => {
    // One pointer drags; a second finger does not take the board from the first.
    if (event.button !== 0 || this.drag) return
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, at: performance.now() }
    this.velocity = { x: 0, y: 0 }
    try { this.canvas.setPointerCapture(event.pointerId) } catch { /* a synthetic pointer */ }
    this.wake()
  }

  private onPointerMove = (event: PointerEvent): void => {
    const at = this.boardAt(event.clientX, event.clientY)
    this.parallax.goalX = at.nx
    this.parallax.goalY = at.ny
    const drag = this.drag
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 5) return
      // Grab the board: it follows the pointer one to one, whatever you grabbed it by.
      const perPixel = this.view.span / this.size.height
      const now = performance.now()
      const dt = Math.max(1, now - drag.at)
      const moveX = -dx * perPixel
      const moveY = dy * perPixel
      this.velocity = { x: (moveX / dt) * 16, y: (moveY / dt) * 16 }
      const next = clampMapView({ ...this.goal, x: this.goal.x + moveX, y: this.goal.y + moveY }, this.layout?.radius || 1)
      this.goal = next
      this.view = { ...this.view, x: next.x, y: next.y }
      this.drag = { ...drag, x: event.clientX, y: event.clientY, moved: true, at: now }
      this.canvas.style.cursor = 'grabbing'
      this.wake()
      return
    }
    this.setHover(this.layout ? pickMapNode(this.layout.nodes, at.x, at.y) : null)
    this.wake(400)
  }

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    this.drag = null
    try { this.canvas.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
    if (!drag.moved && event.type === 'pointerup') {
      const at = this.boardAt(event.clientX, event.clientY)
      const id = this.layout ? pickMapNode(this.layout.nodes, at.x, at.y) : null
      if (id) this.handlers.onPick(id)
    } else if (performance.now() - drag.at > 80) {
      this.velocity = { x: 0, y: 0 } // held still before letting go: no throw
    }
    this.canvas.style.cursor = this.hovered ? 'pointer' : 'grab'
    this.wake(1400)
  }

  private onPointerLeave = (): void => {
    this.parallax.goalX = 0
    this.parallax.goalY = 0
    if (!this.drag) this.setHover(null)
    this.wake()
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    if (!this.layout) return
    const bounds = this.canvas.getBoundingClientRect()
    const px = (event.clientX - bounds.left - bounds.width / 2) / Math.max(1, bounds.height)
    const py = -(event.clientY - bounds.top - bounds.height / 2) / Math.max(1, bounds.height)
    const delta = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY
    this.goal = zoomMapView(this.goal, Math.max(-600, Math.min(600, delta)), px, py, this.layout.radius)
    this.wake()
  }

  private onDoubleClick = (event: MouseEvent): void => {
    const at = this.boardAt(event.clientX, event.clientY)
    if (this.layout && !pickMapNode(this.layout.nodes, at.x, at.y)) this.fit()
  }

  // ── the frame ──

  private tick = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    this.frame += 1
    // At rest only the slow pulses move: every second frame is plenty for them.
    const busy = now < this.busyUntil || this.flashes.size > 0 || this.drag !== null
    if (!busy && this.frame % 2 === 1) return
    if (!this.layout || !this.tiles || !this.glows) return
    const started = performance.now()
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    const ease = 1 - Math.exp(-dt * 11)

    // A thrown board glides on.
    if (!this.drag && (Math.abs(this.velocity.x) > 0.0005 || Math.abs(this.velocity.y) > 0.0005)) {
      this.goal = clampMapView({ ...this.goal, x: this.goal.x + this.velocity.x * dt * 60, y: this.goal.y + this.velocity.y * dt * 60 }, this.layout.radius)
      const drag = Math.exp(-dt * 5.5)
      this.velocity.x *= drag
      this.velocity.y *= drag
      this.wake(200)
    }
    this.view.x += (this.goal.x - this.view.x) * ease
    this.view.y += (this.goal.y - this.view.y) * ease
    this.view.span += (this.goal.span - this.view.span) * ease
    this.parallax.x += (this.parallax.goalX - this.parallax.x) * (1 - Math.exp(-dt * 5))
    this.parallax.y += (this.parallax.goalY - this.parallax.y) * (1 - Math.exp(-dt * 5))

    // The camera looks at the view's centre from slightly off to the pointer's side: a small tilt.
    const distance = this.view.span / (2 * Math.tan((FOV * Math.PI) / 360))
    this.camera.position.set(this.view.x - this.parallax.x * distance * 0.075, this.view.y - this.parallax.y * distance * 0.06, distance)
    this.camera.lookAt(this.view.x, this.view.y, 0)
    this.camera.updateMatrixWorld()

    // Nodes rising under the pointer.
    const scale = this.tiles.geometry.getAttribute('aScale') as THREE.InstancedBufferAttribute
    let scaled = false
    for (let index = 0; index < this.scales.length; index += 1) {
      const goal = this.scaleGoals[index]
      const value = this.scales[index]
      if (Math.abs(goal - value) < 0.0015) continue
      this.scales[index] = value + (goal - value) * (1 - Math.exp(-dt * 16))
      scale.setX(index, this.scales[index])
      scaled = true
    }
    if (scaled) {
      scale.needsUpdate = true
      this.wake(120)
    }

    // A node that just lit up.
    if (this.flashes.size) {
      const glow = this.glows.geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute
      const wall = performance.now()
      for (const [index, startedAt] of this.flashes) {
        const t = (wall - startedAt) / FLASH_MS
        if (t >= 1) {
          this.flashes.delete(index)
          glow.setW(index, 0)
        } else glow.setW(index, 2.6 * (1 - t) * (1 - t))
      }
      glow.needsUpdate = true
    }
    // Far out, nodes hold their size on screen (they overlap their labels a little: those are unreadable there anyway).
    this.uniforms.uZoom.value = Math.min(MAX_ZOOM_GROW, Math.max(1, MIN_NODE_PX / (this.size.height / this.view.span)))
    this.uniforms.uTime.value = (now - this.startedAt) / 1000
    this.uniforms.uFade.value = Math.min(1, (now - this.startedAt) / 320)
    this.renderer.render(this.scene, this.camera)
    this.stats.frames += 1
    this.stats.ms += performance.now() - started
  }
}
