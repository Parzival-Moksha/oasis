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

  it('normalizes browser-window aliases and keeps caller actor context', () => {
    const result = prepareOasisToolArgs(
      'place_browser_window',
      {
        href: 'example.com',
      },
      {
        worldId: 'world-123',
        agentType: 'gemini',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      actorAgentType: 'gemini',
      agentType: 'browser',
      surfaceUrl: 'example.com',
      browserSurfaceMode: 'live-browser',
      frameStyle: 'baroque',
      frameThickness: 7,
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

  it('injects hosted self-craft world and actor context', () => {
    const result = prepareOasisToolArgs(
      'self_craft_scene',
      {
        name: 'Tiny altar',
        objects: [
          { type: 'box', position: [0, 0.5, 0], scale: [1, 1, 1], color: '#ffffff' },
        ],
      },
      {
        worldId: 'world-123',
        agentType: 'openclaw',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      actorAgentType: 'openclaw',
    })
  })

  it('normalizes text-to-picture building defaults', () => {
    const result = prepareOasisToolArgs(
      'text_to_pic_building',
      { prompt: 'a candy storefront' },
      {
        worldId: 'world-123',
        agentType: 'gemini',
      },
    )

    expect(result).toMatchObject({
      worldId: 'world-123',
      actorAgentType: 'gemini',
      frameStyle: 'building',
      frameThickness: 7,
      scale: 4,
    })
  })
})
