import { describe, expect, it } from 'vitest'
import { canReceiveMoveOrder, resolveMoveOrderObjectIds } from '../march-order'

describe('march-order helpers', () => {
  it('detects walkable clips for move orders', () => {
    expect(canReceiveMoveOrder({ clips: [{ name: 'walk', duration: 1 }] })).toBe(true)
    expect(canReceiveMoveOrder({ clips: [{ name: 'idle', duration: 1 }] })).toBe(false)
    expect(canReceiveMoveOrder(undefined)).toBe(false)
  })

  it('keeps orders scoped to the selected avatar', () => {
    const walkableAvatarIds = ['agent-avatar-a', 'agent-avatar-b']
    const objectMeshStats = {
      'agent-avatar-a': { clips: [{ name: 'walk', duration: 1 }] },
      'agent-avatar-b': { clips: [{ name: 'run', duration: 1 }] },
    }

    expect(resolveMoveOrderObjectIds('agent-avatar-a', walkableAvatarIds, objectMeshStats)).toEqual(['agent-avatar-a'])
  })

  it('keeps single-object orders for non-avatar walkables', () => {
    const objectMeshStats = {
      walker: { clips: [{ name: 'locomotion', duration: 1 }] },
    }

    expect(resolveMoveOrderObjectIds('walker', [], objectMeshStats)).toEqual(['walker'])
  })

  it('requires an explicit selection before issuing a move order', () => {
    const walkableAvatarIds = ['agent-avatar-a', 'agent-avatar-b']

    expect(resolveMoveOrderObjectIds(null, walkableAvatarIds, {})).toEqual([])
  })

  it('returns no move targets for non-walkable selections', () => {
    const objectMeshStats = {
      statue: { clips: [{ name: 'idle', duration: 1 }] },
    }

    expect(resolveMoveOrderObjectIds('statue', ['agent-avatar-a'], objectMeshStats)).toEqual([])
  })
})
