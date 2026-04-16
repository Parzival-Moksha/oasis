import { describe, expect, it } from 'vitest'

import { prepareOasisToolArgs } from '../mcp/oasis-tool-spec.js'

describe('prepareOasisToolArgs', () => {
  it('normalizes set_avatar aliases and injects pinned context', () => {
    const result = prepareOasisToolArgs(
      'set_avatar',
      {
        agent: 'Hermes',
        avatar3dUrl: '/avatars/hermes.vrm',
      },
      {
        worldId: 'world-123',
        agentType: 'merlin',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      agentType: 'hermes',
      actorAgentType: 'hermes',
      avatarUrl: '/avatars/hermes.vrm',
    })
  })

  it('normalizes animation aliases and boolean loop modes', () => {
    const result = prepareOasisToolArgs(
      'play_avatar_animation',
      {
        agent: 'hermes',
        animationId: 'ual-dance',
        loop: false,
      },
      {
        worldId: 'world-123',
        agentType: 'merlin',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      agentType: 'hermes',
      actorAgentType: 'hermes',
      clipName: 'ual-dance',
      loop: 'once',
    })
  })

  it('maps activeWorldOnly to inWorldOnly for legacy conjured-asset callers', () => {
    const result = prepareOasisToolArgs(
      'list_conjured_assets',
      {
        activeWorldOnly: true,
      },
      {
        worldId: 'world-123',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      activeWorldOnly: true,
      inWorldOnly: true,
    })
  })

  it('injects default agent context for screenshot calls', () => {
    const result = prepareOasisToolArgs(
      'screenshot_viewport',
      {
        views: [{ id: 'agent-eye', mode: 'agent' }],
      },
      {
        worldId: 'world-123',
        agentType: 'hermes',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      defaultAgentType: 'hermes',
    })
  })
})
