// The intro overlay: "04515 / D3BU9 Y0UR531F" drawn over the live world for about three seconds.
// It replaced the full-screen splash, which hid the world for longer than loading took.
// Everything here is plain data and maths (glyphs, layout, timing, the saved choice) so it can be
// tested without a browser; IntroOverlay.tsx only draws it.
//
// The letters are a 5x7 dot-matrix font drawn as SVG paths: no web font, so it looks the same on
// Windows, Mac and Linux, and a dot-matrix letter is mostly holes, which is the point of the overlay.

export type IntroVariantId = 'pixels' | 'scanline' | 'sigil' | 'ghost' | 'sunrise'
export type IntroChoice = IntroVariantId | 'off'

export interface IntroVariant {
  id: IntroVariantId
  label: string
  blurb: string
}

export const INTRO_VARIANTS: IntroVariant[] = [
  { id: 'pixels', label: 'Pixels', blurb: 'White glass blocks, a cyan underline.' },
  { id: 'scanline', label: 'Scanline', blurb: 'Green phosphor bars and a sweep line.' },
  { id: 'sigil', label: 'Sigil', blurb: 'Gold diamonds inside a drawn ring.' },
  { id: 'ghost', label: 'Ghost', blurb: 'Hollow outlines with a reflection.' },
  { id: 'sunrise', label: 'Sunrise', blurb: 'A striped sun behind magenta dots.' },
]

export const DEFAULT_INTRO_CHOICE: IntroChoice = 'pixels'
export const INTRO_TITLE = '04515'
export const INTRO_SUBTITLE = 'D3BU9 Y0UR531F'

const STORAGE_KEY = 'oasis-intro-overlay'
export const INTRO_PREVIEW_EVENT = 'oasis:intro-overlay-preview'
export const INTRO_CHANGED_EVENT = 'oasis:intro-overlay-changed'

export function isIntroChoice(value: unknown): value is IntroChoice {
  return value === 'off' || INTRO_VARIANTS.some(v => v.id === value)
}

/** URL `?intro=<id|off>` wins, then the saved choice, then the default. */
export function readIntroChoice(): IntroChoice {
  if (typeof window === 'undefined') return DEFAULT_INTRO_CHOICE
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('intro')
    if (isIntroChoice(fromUrl)) return fromUrl
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isIntroChoice(saved)) return saved
  } catch { /* private mode: fall through */ }
  return DEFAULT_INTRO_CHOICE
}

export function saveIntroChoice(choice: IntroChoice): void {
  try { window.localStorage.setItem(STORAGE_KEY, choice) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(INTRO_CHANGED_EVENT, { detail: { choice } }))
}

// ── Timing ────────────────────────────────────────────────────────────────────────────────────

export const INTRO_FADE_IN_MS = 350
export const INTRO_VISIBLE_MS = 3000
export const INTRO_FADE_OUT_MS = 700
/** If the canvas never shows up (a failed load), the overlay still leaves after this long. */
export const INTRO_HARD_CAP_MS = 10000

export type IntroPhase = 'showing' | 'leaving' | 'gone'

/**
 * Where the overlay is in its life. The three seconds count from the moment the world's canvas is
 * on screen (`sceneAtMs`), so they are spent over the world and not over the black page before it.
 * All times are on one clock (performance.now()).
 */
export function introPhase(nowMs: number, mountedAtMs: number, sceneAtMs: number | null): IntroPhase {
  const cap = mountedAtMs + INTRO_HARD_CAP_MS
  const end = sceneAtMs === null ? cap : Math.min(cap, sceneAtMs + INTRO_VISIBLE_MS)
  if (nowMs >= end) return 'gone'
  if (nowMs >= end - INTRO_FADE_OUT_MS) return 'leaving'
  return 'showing'
}

// ── Glyphs ────────────────────────────────────────────────────────────────────────────────────

const GLYPH_W = 5
const GLYPH_H = 7

const GLYPHS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
}

export type CellShape = 'square' | 'bars' | 'diamond' | 'dot'

export interface Cell { x: number; y: number }

/** Top-left corners of the lit cells of `text`, one list per character (a space gives an empty list). */
export function textCells(text: string, originX: number, originY: number, cell: number): Cell[][] {
  return Array.from(text).map((ch, index) => {
    const rows = GLYPHS[ch]
    if (!rows) return []
    const out: Cell[] = []
    const left = originX + index * (GLYPH_W + 1) * cell
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (rows[r][c] === '#') out.push({ x: left + c * cell, y: originY + r * cell })
      }
    }
    return out
  })
}

export function textWidth(text: string, cell: number): number {
  const n = Array.from(text).length
  return n === 0 ? 0 : (n * (GLYPH_W + 1) - 1) * cell
}

export function textHeight(cell: number): number {
  return GLYPH_H * cell
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** One SVG path for a list of cells. `fill` is the share of the cell the mark covers along each axis. */
export function cellsPath(cells: Cell[], cell: number, shape: CellShape, fill = 0.82): string {
  const s = cell * fill
  const pad = (cell - s) / 2
  let d = ''
  for (const { x, y } of cells) {
    const px = r2(x + pad)
    const py = r2(y + pad)
    if (shape === 'square') {
      d += `M${px} ${py}h${r2(s)}v${r2(s)}h${r2(-s)}z`
    } else if (shape === 'bars') {
      // Three thin bars with gaps as tall as the bars: a cell is 3/5 lit.
      const bar = s / 5
      for (let i = 0; i < 3; i++) d += `M${px} ${r2(py + i * 2 * bar)}h${r2(s)}v${r2(bar)}h${r2(-s)}z`
    } else if (shape === 'diamond') {
      const h = s / 2
      d += `M${r2(px + h)} ${py}l${r2(h)} ${r2(h)}l${r2(-h)} ${r2(h)}l${r2(-h)} ${r2(-h)}z`
    } else {
      const rad = r2(s / 2)
      d += `M${px} ${r2(py + s / 2)}a${rad} ${rad} 0 1 0 ${r2(s)} 0a${rad} ${rad} 0 1 0 ${r2(-s)} 0z`
    }
  }
  return d
}

// ── Layout (SVG user units; the SVG scales to fit any screen) ─────────────────────────────────

export const INTRO_VIEW = { width: 1600, height: 900 }
export const TITLE_CELL = 36
export const SUBTITLE_CELL = 10
const TITLE_GAP = 58

export interface IntroLayout {
  titleX: number
  titleY: number
  titleW: number
  titleH: number
  subtitleX: number
  subtitleY: number
  subtitleW: number
  subtitleH: number
  centerX: number
  centerY: number
}

export function introLayout(): IntroLayout {
  const titleW = textWidth(INTRO_TITLE, TITLE_CELL)
  const titleH = textHeight(TITLE_CELL)
  const subtitleW = textWidth(INTRO_SUBTITLE, SUBTITLE_CELL)
  const subtitleH = textHeight(SUBTITLE_CELL)
  const blockH = titleH + TITLE_GAP + subtitleH
  const titleY = Math.round((INTRO_VIEW.height - blockH) / 2) - 20
  return {
    titleX: Math.round((INTRO_VIEW.width - titleW) / 2),
    titleY,
    titleW,
    titleH,
    subtitleX: Math.round((INTRO_VIEW.width - subtitleW) / 2),
    subtitleY: titleY + titleH + TITLE_GAP,
    subtitleW,
    subtitleH,
    centerX: INTRO_VIEW.width / 2,
    centerY: titleY + blockH / 2,
  }
}
