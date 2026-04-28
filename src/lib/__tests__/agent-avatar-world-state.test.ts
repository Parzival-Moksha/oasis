import { describe, expect, it } from 'vitest'

import { normalizeAgentAvatarTransforms } from '../agent-avatar-world-state'

describe('agent avatar world-state normalization', () => {
  it('folds a persisted avatar transform into the avatar and removes the transform entry', () => {
    const normalized = normalizeAgentAvatarTransforms(
      [{
        id: 'agent-avatar-openclaw',
        agentType: 'openclaw',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      {
        'agent-avatar-openclaw': {
          position: [7, 0, -4],
          rotation: [0, 1.5, 0],
          scale: [1.4, 1.4, 1.4],
        },
      },
    )

    expect(normalized.changed).toBe(true)
    expect(normalized.avatars[0]?.position).toEqual([7, 0, -4])
    expect(normalized.avatars[0]?.rotation).toEqual([0, 1.5, 0])
    expect(normalized.avatars[0]?.scale).toBe(1.4)
    expect(normalized.transforms['agent-avatar-openclaw']).toBeUndefined()
  })

  it('preserves non-avatar and orphan transform entries', () => {
    const normalized = normalizeAgentAvatarTransforms(
      [{
        id: 'agent-avatar-openclaw',
        agentType: 'openclaw',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      {
        'rock-1': { position: [1, 0, 1] },
        'missing-avatar': { position: [2, 0, 2] },
      },
    )

    expect(normalized.changed).toBe(false)
    expect(normalized.transforms['rock-1']).toEqual({ position: [1, 0, 1] })
    expect(normalized.transforms['missing-avatar']).toEqual({ position: [2, 0, 2] })
  })
})
