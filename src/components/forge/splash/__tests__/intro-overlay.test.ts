import { describe, expect, it } from 'vitest'
import {
  INTRO_FADE_OUT_MS,
  INTRO_HARD_CAP_MS,
  INTRO_SUBTITLE,
  INTRO_TITLE,
  INTRO_VARIANTS,
  INTRO_VIEW,
  INTRO_VISIBLE_MS,
  SUBTITLE_CELL,
  TITLE_CELL,
  cellsPath,
  introLayout,
  introPhase,
  isIntroChoice,
  textCells,
  textWidth,
} from '../intro-overlay'

describe('introPhase', () => {
  it('counts its three seconds from the moment the canvas is on screen', () => {
    expect(introPhase(0, 0, null)).toBe('showing')
    expect(introPhase(4000, 0, null)).toBe('showing') // still no canvas: the title waits on black
    expect(introPhase(4000, 0, 2500)).toBe('showing')
    expect(introPhase(2500 + INTRO_VISIBLE_MS - INTRO_FADE_OUT_MS, 0, 2500)).toBe('leaving')
    expect(introPhase(2500 + INTRO_VISIBLE_MS, 0, 2500)).toBe('gone')
  })

  it('leaves after the hard cap even when no canvas ever appears', () => {
    expect(introPhase(INTRO_HARD_CAP_MS - 1, 0, null)).toBe('leaving')
    expect(introPhase(INTRO_HARD_CAP_MS, 0, null)).toBe('gone')
    // A canvas that arrives late cannot stretch it past the cap.
    expect(introPhase(INTRO_HARD_CAP_MS, 0, INTRO_HARD_CAP_MS - 500)).toBe('gone')
  })

  it('never goes backwards as time passes', () => {
    const order = { showing: 0, leaving: 1, gone: 2 }
    let last = 0
    for (let t = 0; t <= 12000; t += 50) {
      const now = order[introPhase(t, 0, t >= 1800 ? 1800 : null)]
      expect(now).toBeGreaterThanOrEqual(last)
      last = now
    }
    expect(last).toBe(2)
  })
})

describe('glyphs and layout', () => {
  it('has a glyph for every character of the title and subtitle', () => {
    for (const text of [INTRO_TITLE, INTRO_SUBTITLE]) {
      const cells = textCells(text, 0, 0, 10)
      Array.from(text).forEach((ch, i) => {
        if (ch === ' ') expect(cells[i]).toHaveLength(0)
        else expect(cells[i].length, `glyph ${ch}`).toBeGreaterThan(8)
      })
    }
  })

  it('keeps title and subtitle centred and inside the view', () => {
    const l = introLayout()
    expect(l.titleX + l.titleW / 2).toBeCloseTo(INTRO_VIEW.width / 2, 0)
    expect(l.subtitleX + l.subtitleW / 2).toBeCloseTo(INTRO_VIEW.width / 2, 0)
    expect(l.titleX).toBeGreaterThan(0)
    expect(l.titleY).toBeGreaterThan(0)
    expect(l.subtitleY + l.subtitleH).toBeLessThan(INTRO_VIEW.height)
    expect(l.titleW).toBe(textWidth(INTRO_TITLE, TITLE_CELL))
  })

  it('leaves 70 to 95% of the view untouched (lit cells of both lines, counted whole)', () => {
    const lit = (text: string, cell: number) => textCells(text, 0, 0, cell).flat().length * cell * cell
    const covered = lit(INTRO_TITLE, TITLE_CELL) + lit(INTRO_SUBTITLE, SUBTITLE_CELL)
    const share = covered / (INTRO_VIEW.width * INTRO_VIEW.height)
    expect(share).toBeGreaterThan(0.05)
    expect(share).toBeLessThan(0.3)
  })

  it('draws every shape as closed subpaths with finite numbers', () => {
    const cells = textCells('0', 3, 7, 12).flat()
    for (const shape of ['square', 'bars', 'diamond', 'dot'] as const) {
      const d = cellsPath(cells, 12, shape)
      expect(d).not.toMatch(/NaN|Infinity|undefined/)
      const closes = (d.match(/z/g) ?? []).length
      expect(closes).toBe(cells.length * (shape === 'bars' ? 3 : 1))
    }
  })
})

describe('choice', () => {
  it('accepts the variants and off, nothing else', () => {
    for (const v of INTRO_VARIANTS) expect(isIntroChoice(v.id)).toBe(true)
    expect(isIntroChoice('off')).toBe(true)
    expect(isIntroChoice('wizards-atrium')).toBe(false)
    expect(isIntroChoice(null)).toBe(false)
  })
})
