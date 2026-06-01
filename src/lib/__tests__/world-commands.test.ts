import { describe, expect, it } from 'vitest'

import { applyWorldCommand, paintGroundTilesForCommand } from '@/lib/world-commands/reducer'
import { legacyMutationToWorldCommand, makeWorldCommand, worldCommandToLegacyMutation } from '@/lib/world-commands/legacy-map'
import { makeCommandAcceptedEvent, makeCommandRejectedEvent, makeSnapshotCompactedEvent } from '@/lib/world-commands/events'
import { submitWorldCommand } from '@/lib/world-commands/submit'
import { isWorldCommandEnvelope, validateWorldCommandEnvelope, validateWorldCommandPayloadShape, WORLD_COMMAND_MAX_BYTES } from '@/lib/world-commands/validators'
import { applyRoomWorldCommand } from '../../../packages/oasis-room-server/src/world-reducer'
import type { WorldState } from '@/lib/forge/world-persistence'
import type { WorldCommandEnvelope, WorldCommandKind, WorldCommandPayloadByKind } from '@/lib/world-commands/types'

const now = '2026-05-25T12:00:00.000Z'

function baseWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    version: 1,
    terrain: null,
    groundPresetId: 'grass',
    groundTiles: {},
    terrainHeights: [],
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    portalGates: [],
    spatialWebObjects: [],
    transforms: {},
    behaviors: {},
    lights: [],
    skyBackgroundId: 'night007',
    customGroundPresets: [],
    agentWindows: [],
    agentAvatars: [],
    paintStrokes: [],
    text3dObjects: [],
    savedAt: '2026-05-25T11:00:00.000Z',
    ...overrides,
  }
}

function command<K extends WorldCommandKind>(
  kind: K,
  payload: WorldCommandPayloadByKind[K],
): WorldCommandEnvelope<K> {
  return makeWorldCommand(kind, payload, {
    worldId: 'world-1',
    actorId: 'actor-1',
    id: `cmd-${kind}`,
    createdAt: now,
  })
}

describe('world command reducer', () => {
  it('adds, transforms, and removes catalog objects through the command spine', () => {
    const object = {
      id: 'catalog-chair-1',
      catalogId: 'chair',
      name: 'Chair',
      glbPath: '/models/chair.glb',
      position: [0, 0, 0] as [number, number, number],
      scale: 1,
    }

    const added = applyWorldCommand(baseWorld(), command('object.add', { object })).state
    expect(added.catalogPlacements?.map(item => item.id)).toEqual(['catalog-chair-1'])

    const transformed = applyWorldCommand(added, command('object.transform', {
      id: 'catalog-chair-1',
      position: [1, 2, 3],
      scale: 2,
    })).state
    expect(transformed.transforms['catalog-chair-1']).toEqual({
      position: [1, 2, 3],
      scale: 2,
    })

    const removed = applyWorldCommand(transformed, command('object.remove', { id: 'catalog-chair-1' })).state
    expect(removed.catalogPlacements).toEqual([])
    expect(removed.transforms['catalog-chair-1']).toBeUndefined()
  })

  it('removes an id from every world collection for legacy generic deletes', () => {
    const removed = applyWorldCommand(baseWorld({
      catalogPlacements: [{ id: 'x', catalogId: 'c', name: 'C', glbPath: '/c.glb', position: [0, 0, 0], scale: 1 }],
      craftedScenes: [{ id: 'x', name: 'Scene', prompt: '', objects: [], position: [0, 0, 0], createdAt: now }],
      conjuredAssetIds: ['x'],
      portalGates: [{ id: 'x', variant: 'stargate-vortex', position: [0, 0, 0], rotationY: 0, scale: 1, width: 2, height: 3 }],
      spatialWebObjects: [{ id: 'x', type: 'button', label: 'B', position: [0, 0, 0] }],
      lights: [{ id: 'x', type: 'point', color: '#fff', intensity: 1, position: [0, 1, 0], visible: true }],
      paintStrokes: [{ id: 'x', type: 'paint_stroke', points: [], color: '#fff', thickness: 0.04, shininess: 0.5, mode: '3d', createdAt: Date.parse(now) }],
      text3dObjects: [{ id: 'x', type: 'text_3d', text: 'x', position: [0, 0, 0], rotation: [0, 0, 0], size: 1, depth: 0.1, color: '#fff', shininess: 0.5, fontId: 'helvetiker_regular', createdAt: Date.parse(now) }],
      agentWindows: [{ id: 'x', agentType: 'browser', label: 'Window', position: [0, 1, 0], rotation: [0, 0, 0], scale: 1, width: 1, height: 1, sessionId: 's' }],
      agentAvatars: [{ id: 'linked-avatar', agentType: 'browser', linkedWindowId: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, avatar3dUrl: '/a.vrm', label: 'A' }],
      transforms: { x: { position: [1, 0, 1] }, 'linked-avatar': { position: [2, 0, 2] } },
      behaviors: { x: { movement: { type: 'static' }, visible: true }, 'linked-avatar': { movement: { type: 'static' }, visible: true } },
    }), command('object.remove', { id: 'x', linkedAvatarIds: ['linked-avatar'] })).state

    expect(removed.catalogPlacements).toEqual([])
    expect(removed.craftedScenes).toEqual([])
    expect(removed.conjuredAssetIds).toEqual([])
    expect(removed.portalGates).toEqual([])
    expect(removed.spatialWebObjects).toEqual([])
    expect(removed.lights).toEqual([])
    expect(removed.paintStrokes).toEqual([])
    expect(removed.text3dObjects).toEqual([])
    expect(removed.agentWindows).toEqual([])
    expect(removed.agentAvatars).toEqual([])
    expect(removed.transforms.x).toBeUndefined()
    expect(removed.transforms['linked-avatar']).toBeUndefined()
    expect(removed.behaviors?.x).toBeUndefined()
    expect(removed.behaviors?.['linked-avatar']).toBeUndefined()
  })

  it('updates media opacity through the catalog object command path', () => {
    const next = applyWorldCommand(baseWorld({
      catalogPlacements: [{
        id: 'image-1',
        catalogId: 'generated-image',
        name: 'Image',
        glbPath: '',
        position: [0, 0, 0],
        scale: 1,
        imageUrl: '/generated-images/image.png',
      }],
    }), command('object.update', {
      id: 'image-1',
      updates: { mediaOpacity: 0.35 },
    })).state

    expect(next.catalogPlacements?.[0]).toMatchObject({
      id: 'image-1',
      mediaOpacity: 0.35,
    })
  })

  it('persists spatial-web values as first-class world commands', () => {
    const world = baseWorld({
      spatialWebObjects: [{
        id: 'slider-1',
        type: 'slider',
        label: 'Hype',
        position: [0, 0, 0],
        value: 0,
      }],
    })

    const next = applyWorldCommand(world, command('spatial.value.set', {
      id: 'slider-1',
      value: 7,
      event: 'change',
      stateScope: 'world',
      statusMessage: 'Saved',
    })).state

    expect(next.spatialWebObjects?.[0]).toMatchObject({
      id: 'slider-1',
      value: 7,
      lastEvent: 'change',
      lastInteractionAt: now,
      statusMessage: 'Saved',
    })
  })

  it('keeps session-scoped spatial-web values out of the durable world snapshot', () => {
    const world = baseWorld({
      spatialWebObjects: [{
        id: 'slider-1',
        type: 'slider',
        label: 'Hype',
        position: [0, 0, 0],
        value: 0,
      }],
    })

    const result = applyWorldCommand(world, command('spatial.value.set', {
      id: 'slider-1',
      value: 7,
      event: 'change',
      stateScope: 'session',
    }))

    expect(result.changed).toBe(false)
    expect(result.state.spatialWebObjects?.[0]?.value).toBe(0)
  })

  it('stores shared media playback on the target object behavior', () => {
    const next = applyWorldCommand(baseWorld(), command('media.playback.set', {
      objectId: 'speaker-1',
      playbackScope: 'shared',
      state: 'playing',
      audioUrl: '/uploads/song.mp3',
      volume: 0.6,
      maxDistance: 18,
      loop: true,
      playbackId: 'playback-1',
      startedAt: now,
      updatedAt: now,
    })).state

    expect(next.behaviors?.['speaker-1']).toMatchObject({
      visible: true,
      audioUrl: '/uploads/song.mp3',
      audioState: 'playing',
      audioPlaybackScope: 'shared',
      audioPlaybackId: 'playback-1',
      audioLoop: true,
    })
  })

  it('keeps local media preview playback out of the world behavior map', () => {
    const result = applyWorldCommand(baseWorld(), command('media.playback.set', {
      objectId: 'preview-1',
      playbackScope: 'local',
      state: 'playing',
      audioUrl: '/uploads/preview.mp3',
    }))

    expect(result.changed).toBe(false)
    expect(result.state.behaviors?.['preview-1']).toBeUndefined()
  })

  it('removes linked agent avatar state with the agent window command', () => {
    const next = applyWorldCommand(baseWorld({
      agentWindows: [{
        id: 'window-1',
        agentType: 'browser',
        linkedAvatarId: 'avatar-1',
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        scale: 1,
        width: 1,
        height: 1,
      }],
      agentAvatars: [{
        id: 'avatar-1',
        agentType: 'browser',
        linkedWindowId: 'window-1',
        avatar3dUrl: '/a.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      transforms: {
        'window-1': { position: [1, 0, 1] },
        'avatar-1': { position: [2, 0, 2] },
      },
      behaviors: {
        'window-1': { movement: { type: 'static' }, visible: true },
        'avatar-1': { movement: { type: 'static' }, visible: true },
      },
    }), command('agent.window.remove', {
      id: 'window-1',
      linkedAvatarId: 'avatar-1',
    })).state

    expect(next.agentWindows).toEqual([])
    expect(next.agentAvatars).toEqual([])
    expect(next.transforms['window-1']).toBeUndefined()
    expect(next.transforms['avatar-1']).toBeUndefined()
    expect(next.behaviors?.['window-1']).toBeUndefined()
    expect(next.behaviors?.['avatar-1']).toBeUndefined()
  })

  it('keeps the room reducer in parity for linked agent window removal', () => {
    const before = baseWorld({
      agentWindows: [{
        id: 'window-1',
        agentType: 'browser',
        linkedAvatarId: 'avatar-1',
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        scale: 1,
        width: 1,
        height: 1,
      }],
      agentAvatars: [{
        id: 'avatar-1',
        agentType: 'browser',
        linkedWindowId: 'window-1',
        avatar3dUrl: '/a.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      transforms: {
        'window-1': { position: [1, 0, 1] },
        'avatar-1': { position: [2, 0, 2] },
      },
      behaviors: {
        'window-1': { movement: { type: 'static' }, visible: true },
        'avatar-1': { movement: { type: 'static' }, visible: true },
      },
    })
    const cmd = command('agent.window.remove', { id: 'window-1', linkedAvatarId: 'avatar-1' })
    const canonical = applyWorldCommand(before, cmd).state
    const room = applyRoomWorldCommand(before, cmd).state

    expect(room.agentWindows).toEqual(canonical.agentWindows)
    expect(room.agentAvatars).toEqual(canonical.agentAvatars)
    expect(room.transforms).toEqual(canonical.transforms)
    expect(room.behaviors).toEqual(canonical.behaviors)
  })

  it('paints stretched ground tiles by replacing overlapping smaller cells', () => {
    const prefilled = paintGroundTilesForCommand({}, 0, 0, 'grass', 3, 1)
    expect(Object.keys(prefilled)).toHaveLength(9)

    const next = paintGroundTilesForCommand(prefilled, 0, 0, 'stone', 1, 4)
    expect(next['0,0']).toBe('stone@4')
    expect(next['1,1']).toBeUndefined()
    expect(next['-1,-1']).toBe('grass')
  })

  it('maps legacy multiplayer mutations into world commands', () => {
    const mapped = legacyMutationToWorldCommand({
      kind: 'ground_painted',
      payload: { cx: 1, cz: 2, presetId: 'sand', size: 1, stretch: 2 },
    }, {
      worldId: 'world-1',
      actorId: 'actor-1',
      createdAt: now,
    })

    expect(mapped).toMatchObject({
      kind: 'ground.paint',
      payload: { cx: 1, cz: 2, presetId: 'sand', size: 1, stretch: 2 },
    })
  })

  it('maps legacy spatial-web mutations into command-rail shapes', () => {
    const mapped = legacyMutationToWorldCommand({
      kind: 'spatial_web_value_set',
      payload: {
        id: 'slider-1',
        value: 9,
        event: 'change',
        lastInteractionAt: now,
      },
    }, {
      worldId: 'world-1',
      actorId: 'actor-1',
      createdAt: now,
    })

    expect(mapped).toMatchObject({
      kind: 'spatial.value.set',
      payload: { id: 'slider-1', value: 9, event: 'change' },
    })
  })

  it('maps accepted command events back to legacy multiplayer mutations during cutover', () => {
    const mapped = worldCommandToLegacyMutation(command('media.playback.set', {
      objectId: 'speaker-1',
      playbackScope: 'shared',
      state: 'playing',
      audioUrl: '/uploads/song.mp3',
      loop: true,
    }))

    expect(mapped).toMatchObject({
      kind: 'behavior_updated',
      payload: {
        id: 'speaker-1',
        updates: {
          audioState: 'playing',
          audioUrl: '/uploads/song.mp3',
          audioLoop: true,
        },
      },
    })
  })
})

describe('world command validators', () => {
  it('accepts a valid command envelope and rejects oversized payloads', () => {
    const valid = command('ground.setPreset', { groundPresetId: 'sand' })
    expect(isWorldCommandEnvelope(valid)).toBe(true)
    expect(validateWorldCommandEnvelope(valid)).toMatchObject({ ok: true })

    const oversized = {
      ...valid,
      payload: { groundPresetId: 'x'.repeat(WORLD_COMMAND_MAX_BYTES + 1) },
    }
    expect(isWorldCommandEnvelope(oversized)).toBe(false)
  })

  it('rejects corrupt transform scale payloads', () => {
    expect(validateWorldCommandPayloadShape('object.transform', { id: 'x', scale: {} })).toMatch(/scale/)
    expect(validateWorldCommandPayloadShape('object.transform', { id: 'x', scale: -1 })).toMatch(/scale/)
    expect(validateWorldCommandPayloadShape('object.transform', { id: 'x', scale: 2 })).toBeNull()
    expect(validateWorldCommandPayloadShape('object.transform', { id: 'x', scale: [1, 1, 1] })).toBeNull()
  })

  it('rejects malformed object and light add payloads', () => {
    expect(validateWorldCommandPayloadShape('object.add', {
      object: { id: 'obj-1', catalogId: 'tree', name: 'Tree', scale: 1 },
    })).toMatch(/position/)
    expect(validateWorldCommandPayloadShape('light.add', {
      light: { id: 'light-1', type: 'laser', intensity: 1, position: [0, 1, 0] },
    })).toMatch(/type/)
  })
})

describe('world command events and submit helper', () => {
  it('creates accepted and compacted events with stable command references', () => {
    const cmd = command('ground.setPreset', { groundPresetId: 'stone' })

    expect(makeCommandAcceptedEvent(cmd, { revision: 3, acceptedAt: now })).toMatchObject({
      kind: 'command.accepted',
      worldId: 'world-1',
      commandId: cmd.id,
      actorId: 'actor-1',
      revision: 3,
      command: cmd,
    })

    expect(makeSnapshotCompactedEvent({ worldId: 'world-1', revision: 4, acceptedAt: now })).toMatchObject({
      kind: 'snapshot.compacted',
      worldId: 'world-1',
      revision: 4,
    })
  })

  it('submits commands against local state when no room transport is present', async () => {
    const result = await submitWorldCommand('sky.set', { skyBackgroundId: 'sunset' }, {
      worldId: 'world-1',
      actorId: 'actor-1',
      commandId: 'cmd-local-sky',
      createdAt: now,
    }, {
      currentState: baseWorld(),
      currentRevision: 7,
    })

    expect(result.accepted).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.event).toMatchObject({ kind: 'command.accepted', revision: 8 })
    expect(result.state?.skyBackgroundId).toBe('sunset')
  })

  it('routes commands through a transport and can apply an optimistic draft', async () => {
    const sent: WorldCommandEnvelope[] = []
    const result = await submitWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'actor-1',
      commandId: 'cmd-remote-ground',
      createdAt: now,
    }, {
      currentState: baseWorld(),
      currentRevision: 2,
      optimistic: true,
      transport: {
        sendCommand: async submitted => {
          sent.push(submitted)
          return makeCommandAcceptedEvent(submitted, { revision: 3, acceptedAt: now })
        },
      },
    })

    expect(sent).toHaveLength(1)
    expect(result.accepted).toBe(true)
    expect(result.optimisticApplied).toBe(true)
    expect(result.state?.groundPresetId).toBe('sand')
  })

  it('does not expose an optimistic draft as changed state when transport rejects', async () => {
    const world = baseWorld({ groundPresetId: 'grass' })
    const result = await submitWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'actor-1',
      commandId: 'cmd-rejected-ground',
      createdAt: now,
    }, {
      currentState: world,
      currentRevision: 2,
      optimistic: true,
      transport: {
        sendCommand: async submitted => makeCommandRejectedEvent(submitted, {
          revision: 2,
          acceptedAt: now,
          error: 'nope',
        }),
      },
    })

    expect(result.accepted).toBe(false)
    expect(result.changed).toBe(false)
    expect(result.optimisticApplied).toBe(false)
    expect(result.state?.groundPresetId).toBe('grass')
  })

  it('rejects submit when neither transport nor local state is available', async () => {
    const result = await submitWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'actor-1',
      commandId: 'cmd-no-path',
      createdAt: now,
    })

    expect(result.accepted).toBe(false)
    expect(result.event.kind).toBe('command.rejected')
    expect(result.error).toMatch(/no command transport/i)
  })
})
