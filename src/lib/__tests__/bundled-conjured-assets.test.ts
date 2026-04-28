import { describe, expect, it } from 'vitest'

import { getBundledConjuredAssets } from '../conjure/bundled-assets'

describe('bundled conjured assets', () => {
  it('exposes the tracked starter GLBs as ready assets for fresh clones', () => {
    const assets = getBundledConjuredAssets()
    const ids = assets.map(asset => asset.id)

    expect(ids).toContain('conj_mm3uhazzrh34')
    expect(ids).toContain('conj_mm6nig1zk5eo')
    expect(ids).toContain('conj_mn6ogn4ae05j')
    expect(assets.every(asset => asset.status === 'ready' && asset.glbPath?.endsWith('.glb'))).toBe(true)
  })
})
