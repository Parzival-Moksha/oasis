// Where the main menu's tiles go on a screen of any size. Plain maths.
// The tiles live in the middle 60% of the width, under the title; the grid picks the number of
// columns that gives the largest tiles, so a wide monitor, a laptop and a tall window all work.

export interface MenuRect { x: number; y: number; w: number; h: number }

export interface MenuLayout {
  cols: number
  rows: number
  gap: number
  /** The band the tiles may use (the middle 60% of the width). */
  region: MenuRect
  /** The title's band, above the tiles. */
  title: MenuRect
  /** One rect per tile, in order, in CSS pixels from the top-left of the view. */
  tiles: MenuRect[]
}

const REGION_WIDTH = 0.6
const REGION_TOP = 0.33
const REGION_BOTTOM = 0.91
const TITLE_TOP = 0.105
const TITLE_BOTTOM = 0.29
const MAX_ASPECT = 1.7 // widest a tile gets (w / h)
const MIN_ASPECT = 0.85 // tallest
const MAX_TILE_WIDTH = 460

export function menuLayout(viewW: number, viewH: number, count: number): MenuLayout {
  const w = Math.max(320, viewW)
  const h = Math.max(240, viewH)
  const region: MenuRect = { x: w * (1 - REGION_WIDTH) / 2, y: h * REGION_TOP, w: w * REGION_WIDTH, h: h * (REGION_BOTTOM - REGION_TOP) }
  const title: MenuRect = { x: region.x, y: h * TITLE_TOP, w: region.w, h: h * (TITLE_BOTTOM - TITLE_TOP) }
  const gap = Math.round(Math.max(8, Math.min(28, Math.min(w, h) * 0.022)))
  const n = Math.max(1, count)

  let best = { cols: 1, rows: n, tw: 0, th: 0, area: -1 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    let tw = (region.w - gap * (cols - 1)) / cols
    let th = (region.h - gap * (rows - 1)) / rows
    if (tw <= 0 || th <= 0) continue
    if (tw / th > MAX_ASPECT) tw = th * MAX_ASPECT
    if (tw / th < MIN_ASPECT) th = tw / MIN_ASPECT
    if (tw > MAX_TILE_WIDTH) { th *= MAX_TILE_WIDTH / tw; tw = MAX_TILE_WIDTH }
    // A full last row looks better than a ragged one: a small bonus for it.
    const area = tw * th * (n % cols === 0 ? 1.08 : 1)
    if (area > best.area) best = { cols, rows, tw, th, area }
  }

  const { cols, rows, tw, th } = best
  const gridH = rows * th + gap * (rows - 1)
  const top = region.y + (region.h - gridH) / 2
  const tiles: MenuRect[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols
    const rowW = inRow * tw + gap * (inRow - 1)
    const left = region.x + (region.w - rowW) / 2
    tiles.push({ x: left + col * (tw + gap), y: top + row * (th + gap), w: tw, h: th })
  }
  return { cols, rows, gap, region, title, tiles }
}
