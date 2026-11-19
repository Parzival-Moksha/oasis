import { describe, expect, it } from 'vitest'
import { WIZARD_DOCK_MIN_WIDTH, wizardDockGeometry, wizardDockMaxWidth } from '../wizard-dock'

describe('wizardDockGeometry', () => {
  it('takes a third of a wide screen by default', () => {
    const g = wizardDockGeometry(1800, null)
    expect(g.side).toBe('right')
    expect(g.width).toBe(600)
    expect(g.inset).toBe(624)
  })

  it('keeps the remembered width within bounds', () => {
    expect(wizardDockGeometry(1600, 100).width).toBe(WIZARD_DOCK_MIN_WIDTH)
    expect(wizardDockGeometry(1600, 5000).width).toBe(wizardDockMaxWidth(1600))
    expect(wizardDockGeometry(1600, 500).width).toBe(500)
  })

  it('leaves the world at least 300 px', () => {
    const g = wizardDockGeometry(1000, 2000)
    expect(1000 - g.inset).toBeGreaterThanOrEqual(300 - 1)
  })

  it('is a full-width sheet on phones and shifts nothing', () => {
    const g = wizardDockGeometry(400, 500)
    expect(g.side).toBe('sheet')
    expect(g.inset).toBe(0)
  })
})
