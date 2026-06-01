import { describe, expect, it } from 'vitest'
import { resolvePanelZIndex } from '../slices/panelZSlice'

describe('panel z-order slice helpers', () => {
  it('returns the default layer before a panel has focus order', () => {
    expect(resolvePanelZIndex(undefined, 42)).toBe(42)
    expect(resolvePanelZIndex(0, 42)).toBe(42)
  })

  it('keeps focused panels above their declared base layer', () => {
    expect(resolvePanelZIndex(1, 50)).toBe(9991)
    expect(resolvePanelZIndex(3, 9999)).toBe(10002)
  })
})
