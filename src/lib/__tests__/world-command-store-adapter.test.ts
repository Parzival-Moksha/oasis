import { describe, expect, it } from 'vitest'

import { applyStoreWorldCommand, storeStateToWorldState, worldStateToStorePatch, type WorldCommandStoreState } from '@/lib/world-commands/store-adapter'

const baseStoreState = (): WorldCommandStoreState => ({
  terrainParams: null,
  terrainHeights: [],
  groundPresetId: 'grass',
  groundTiles: {},
  craftedScenes: [],
  worldConjuredAssetIds: [],
  placedCatalogAssets: [],
  portalGates: [],
  spatialWebObjects: [],
  paintStrokes: [],
  text3dObjects: [],
  transforms: {},
  behaviors: {},
  worldLights: [],
  worldSkyBackground: 'night007',
  customGroundPresets: [],
  placedAgentWindows: [],
  placedAgentAvatars: [],
  _worldLoadedAt: '2026-06-01T11:00:00.000Z',
})

describe('world command store adapter', () => {
  it('maps Oasis store field names to WorldState field names and back', () => {
    const world = storeStateToWorldState({
      ...baseStoreState(),
      placedCatalogAssets: [{
        id: 'image-1',
        catalogId: 'generated-image',
        name: 'Image',
        glbPath: '',
        position: [0, 0, 0],
        scale: 1,
      }],
      worldLights: [{
        id: 'light-1',
        type: 'ambient',
        color: '#ffffff',
        intensity: 1,
        position: [0, 1, 0],
        visible: true,
      }],
      worldSkyBackground: 'sunset',
    })

    expect(world.catalogPlacements?.[0].id).toBe('image-1')
    expect(world.lights?.[0].id).toBe('light-1')
    expect(world.skyBackgroundId).toBe('sunset')

    expect(worldStateToStorePatch(world)).toMatchObject({
      placedCatalogAssets: [{ id: 'image-1' }],
      worldLights: [{ id: 'light-1' }],
      worldSkyBackground: 'sunset',
    })
  })

  it('applies a durable command and returns the legacy mutation for today bus', () => {
    const result = applyStoreWorldCommand(baseStoreState(), 'sky.set', { skyBackgroundId: 'aurora' }, {
      worldId: 'world-1',
      actorId: 'local-user',
      createdAt: '2026-06-01T12:00:00.000Z',
    })

    expect(result.command.kind).toBe('sky.set')
    expect(result.patch.worldSkyBackground).toBe('aurora')
    expect(result.legacyMutation).toEqual({
      kind: 'sky_changed',
      payload: { skyBackgroundId: 'aurora' },
    })
  })

  it('routes spatial, text, behavior, and transform mutations through store patches', () => {
    const object = {
      id: 'spatial-spellbook',
      type: 'button' as const,
      label: 'Spellbook',
      position: [1, 1, 1] as [number, number, number],
    }
    const withSpatial = applyStoreWorldCommand(baseStoreState(), 'spatial.add', { object }, {
      worldId: 'world-1',
      actorId: 'local-user',
      createdAt: '2026-06-01T12:01:00.000Z',
    })

    expect(withSpatial.patch.spatialWebObjects).toEqual([object])
    expect(withSpatial.legacyMutation).toEqual({ kind: 'spatial_web_added', payload: object })

    const withText = applyStoreWorldCommand(withSpatial.patch as WorldCommandStoreState, 'text3d.add', {
      object: {
        id: 'text-1',
        type: 'text_3d',
        text: 'Hello',
        fontId: 'helvetiker_regular',
        size: 0.5,
        depth: 0.12,
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        color: '#ffffff',
        shininess: 0.8,
        createdAt: 1,
      },
    }, {
      worldId: 'world-1',
      actorId: 'local-user',
      createdAt: '2026-06-01T12:02:00.000Z',
    })

    expect(withText.patch.text3dObjects?.[0]?.id).toBe('text-1')

    const withBehavior = applyStoreWorldCommand(withText.patch as WorldCommandStoreState, 'object.behavior.update', {
      id: 'spatial-spellbook',
      updates: { label: 'Awakened Spellbook', visible: true },
    }, {
      worldId: 'world-1',
      actorId: 'local-user',
      createdAt: '2026-06-01T12:03:00.000Z',
    })

    expect(withBehavior.patch.behaviors?.['spatial-spellbook']).toMatchObject({ label: 'Awakened Spellbook', visible: true })

    const withTransform = applyStoreWorldCommand(withBehavior.patch as WorldCommandStoreState, 'object.transform', {
      id: 'spatial-spellbook',
      position: [2, 1.5, -3],
      rotation: [0, 0.3, 0],
      scale: 1.2,
    }, {
      worldId: 'world-1',
      actorId: 'local-user',
      createdAt: '2026-06-01T12:04:00.000Z',
    })

    expect(withTransform.patch.transforms?.['spatial-spellbook']).toMatchObject({
      position: [2, 1.5, -3],
      rotation: [0, 0.3, 0],
      scale: 1.2,
    })
  })
})
