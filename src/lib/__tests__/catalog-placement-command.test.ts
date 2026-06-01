import { describe, expect, it } from 'vitest'

import { applyCatalogPlacementUpdateCommand } from '@/lib/world-commands/catalog-placement'
import type { CatalogPlacement } from '@/lib/conjure/types'

const imagePlacement: CatalogPlacement = {
  id: 'image-1',
  catalogId: 'generated-image',
  name: 'Image',
  glbPath: '',
  position: [0, 0, 0],
  scale: 1,
  imageUrl: '/generated-images/image.png',
}

describe('catalog placement command adapter', () => {
  it('updates media placement fields through object.update', () => {
    const result = applyCatalogPlacementUpdateCommand(
      [imagePlacement],
      'image-1',
      { mediaOpacity: 0.42, imageFrameThickness: 2 },
      {
        worldId: 'world-1',
        actorId: 'local-user',
        createdAt: '2026-06-01T12:00:00.000Z',
      },
    )

    expect(result.command).toMatchObject({
      kind: 'object.update',
      worldId: 'world-1',
      actorId: 'local-user',
      payload: {
        id: 'image-1',
        updates: { mediaOpacity: 0.42, imageFrameThickness: 2 },
      },
    })
    expect(result.placements[0]).toMatchObject({
      id: 'image-1',
      mediaOpacity: 0.42,
      imageFrameThickness: 2,
    })
    expect(result.legacyMutation).toEqual({
      kind: 'object_updated',
      payload: {
        id: 'image-1',
        updates: { mediaOpacity: 0.42, imageFrameThickness: 2 },
      },
    })
  })

  it('does not invent a placement when the target id is missing', () => {
    const result = applyCatalogPlacementUpdateCommand(
      [imagePlacement],
      'missing',
      { mediaOpacity: 0.2 },
      {
        worldId: 'world-1',
        actorId: 'local-user',
      },
    )

    expect(result.placements).toEqual([imagePlacement])
  })
})
