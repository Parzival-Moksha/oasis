import { describe, expect, it } from 'vitest'

import {
  emptyMouthShapeWeights,
  mapMouthWeightsToLegacyLipSyncState,
} from '../lip-sync-lab'

describe('mapMouthWeightsToLegacyLipSyncState', () => {
  it('passes vowel weights through to the legacy five-shape state', () => {
    const weights = emptyMouthShapeWeights()
    weights.aa = 0.7
    weights.ee = 0.5
    weights.ih = 0.4
    weights.oh = 0.3
    weights.ou = 0.2

    expect(mapMouthWeightsToLegacyLipSyncState(weights)).toEqual({
      aa: 0.7,
      ih: 0.4,
      ou: 0.2,
      ee: 0.5,
      oh: 0.3,
    })
  })

  it('folds consonant-heavy cues into the closest legacy mouth slots', () => {
    const weights = emptyMouthShapeWeights()
    weights.pp = 1
    weights.ss = 0.8
    weights.rr = 0.9

    expect(mapMouthWeightsToLegacyLipSyncState(weights)).toEqual({
      aa: 0,
      ih: 0.656,
      ou: 0.58,
      ee: 0.378,
      oh: 0,
    })
  })
})
