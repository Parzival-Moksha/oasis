import { describe, expect, it } from 'vitest'

import catalogExtras from '../../../data/asset-catalog-extras.json'
import {
  ASSET_CATALOG,
  ASSET_CATALOG_ALIASES,
  resolveCatalogAssetDefinition,
  resolveCatalogAssetId,
} from '../../components/scene-lib/constants'

describe('asset catalog legacy aliases', () => {
  const catalogIds = new Set(ASSET_CATALOG.map(asset => asset.id))
  const qfDeletedIds = catalogExtras.deletedIds.filter(id => id.startsWith('qf_'))

  it('keeps retired Quaternius fantasy ids out of the visible catalog', () => {
    expect(qfDeletedIds.length).toBeGreaterThan(0)
    for (const legacyId of qfDeletedIds) {
      expect(catalogIds.has(legacyId)).toBe(false)
    }
  })

  it('resolves every retired Quaternius fantasy id to a live equivalent', () => {
    for (const legacyId of qfDeletedIds) {
      const targetId = ASSET_CATALOG_ALIASES[legacyId]
      expect(targetId, `${legacyId} should have a catalog alias`).toBeTruthy()
      expect(catalogIds.has(targetId), `${legacyId} aliases to missing ${targetId}`).toBe(true)
      expect(resolveCatalogAssetId(legacyId)).toBe(targetId)
      expect(resolveCatalogAssetDefinition(legacyId)?.id).toBe(targetId)
    }
  })

  it('resolves every retired baked-in id to a live renderable catalog asset', () => {
    for (const legacyId of catalogExtras.deletedIds) {
      const resolved = resolveCatalogAssetDefinition(legacyId)
      expect(resolved?.id, `${legacyId} should resolve to a live asset`).toBeTruthy()
      expect(catalogIds.has(resolved!.id)).toBe(true)
    }
  })

  it('covers the broken assets visible in old saved worlds', () => {
    expect(resolveCatalogAssetDefinition('qf_dummy')?.path).toBe('/models/fantasy-props/dummy.gltf')
    expect(resolveCatalogAssetDefinition('qf_bookcase')?.path).toBe('/models/fantasy-props/bookcase_2.gltf')
    expect(resolveCatalogAssetDefinition('qf_potion_1')?.path).toBe('/models/fantasy-props/potion_1.gltf')
    expect(resolveCatalogAssetDefinition('qf_barrel_apples')?.path).toBe('/models/fantasy-props/barrel_apples.gltf')
  })
})
