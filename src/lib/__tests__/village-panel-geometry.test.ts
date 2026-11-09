import { describe, expect, it } from 'vitest'
import { SESSION_PANEL_MIN_WIDTH, getSessionPanelGeometry, sessionPanelMaxWidth } from '../../components/village/village-actions'

// The talk panel's width: automatic, or what the owner dragged it to (clamped so the world stays beside it).

describe('getSessionPanelGeometry', () => {
  it('is automatic without a dragged width', () => {
    expect(getSessionPanelGeometry(1280, 720, null)).toMatchObject({ side: 'right', width: 461 })
    expect(getSessionPanelGeometry(1920, 1080, null).width).toBe(520)
  })

  it('takes the dragged width, within the minimum and the room the world needs', () => {
    expect(getSessionPanelGeometry(1920, 1080, 800).width).toBe(800)
    expect(getSessionPanelGeometry(1920, 1080, 100).width).toBe(SESSION_PANEL_MIN_WIDTH)
    expect(getSessionPanelGeometry(1280, 720, 5000).width).toBe(sessionPanelMaxWidth(1280))
    expect(sessionPanelMaxWidth(1280)).toBe(980)
    expect(sessionPanelMaxWidth(3840)).toBe(1400)
    // the camera framing follows the panel
    const wide = getSessionPanelGeometry(1920, 1080, 900)
    expect(wide.fraction).toBeCloseTo((900 + 24) / 1920, 5)
  })

  it('stays a bottom sheet on phones whatever was dragged', () => {
    expect(getSessionPanelGeometry(390, 844, 900)).toMatchObject({ side: 'bottom', width: 366 })
  })
})
