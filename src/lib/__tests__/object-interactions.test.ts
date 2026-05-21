import { describe, expect, it } from 'vitest'

import { findNearestObjectInteraction } from '../object-interactions'

describe('findNearestObjectInteraction', () => {
  it('finds the nearest interactable catalog object and skips hidden hooks', () => {
    const nearest = findNearestObjectInteraction({
      actorPosition: [0, 0, 0],
      transforms: {},
      catalogPlacements: [
        {
          id: 'far-picture',
          catalogId: 'generated-image',
          name: 'Far Picture',
          glbPath: '',
          imageUrl: '/far.webp',
          position: [9, 0, 0],
          scale: 1,
        },
        {
          id: 'near-picture',
          catalogId: 'generated-image',
          name: 'Near Picture',
          glbPath: '',
          imageUrl: '/near.webp',
          position: [2, 0, 0],
          scale: 1,
        },
      ],
      behaviors: {
        'far-picture': {
          visible: false,
          movement: { type: 'static' },
          interaction: { radius: 12, actions: [{ type: 'spawn_vfx' }] },
        },
        'near-picture': {
          visible: true,
          label: 'Open near',
          movement: { type: 'static' },
          interaction: { radius: 3, actions: [{ type: 'html_overlay', url: '/near.html' }] },
        },
      },
    })

    expect(nearest).toMatchObject({
      id: 'near-picture',
      label: 'Open near',
      position: [2, 0, 0],
    })
  })
})
