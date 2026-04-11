import { describe, expect, it } from 'vitest'

import {
  clampMerlinGeometry,
  clampMerlinPanelPosition,
  clampMerlinPanelSize,
} from '../merlin-panel-geometry'

describe('merlin panel geometry', () => {
  it('clamps persisted position back into the viewport', () => {
    const position = clampMerlinPanelPosition(
      { x: 999, y: -120 },
      { w: 380, h: 520 },
      { width: 1280, height: 720 },
    )

    expect(position).toEqual({ x: 900, y: 0 })
  })

  it('shrinks oversized panels to fit the viewport before clamping position', () => {
    const geometry = clampMerlinGeometry(
      { x: 240, y: 180 },
      { w: 1600, h: 1200 },
      { width: 1024, height: 640 },
      320,
      300,
    )

    expect(geometry.size).toEqual({ w: 1024, h: 640 })
    expect(geometry.position).toEqual({ x: 0, y: 0 })
  })

  it('preserves configured minimum size when the viewport has room', () => {
    const size = clampMerlinPanelSize(
      { w: 100, h: 120 },
      { width: 1440, height: 900 },
      320,
      300,
    )

    expect(size).toEqual({ w: 320, h: 300 })
  })
})
