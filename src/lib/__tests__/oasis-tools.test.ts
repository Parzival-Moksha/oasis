// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS MCP TOOLS — Unit tests
// Tests: callTool dispatcher, TOOL_NAMES, search_assets, get_asset_catalog,
//        place_object, set_sky, paint_ground_tiles, remove_object,
//        clear_world, deliverScreenshot, isScreenshotPending
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// MOCKS — must be declared before imports
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('server-only', () => ({}))

vi.mock('../db', () => ({
  prisma: {
    world: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { callTool, TOOL_NAMES, deliverScreenshot, getPendingScreenshotRequest, isScreenshotPending } from '../mcp/oasis-tools'
import { prisma } from '../db'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function makeWorldRow(state: Record<string, unknown> = {}) {
  const base = {
    version: 1,
    terrain: null,
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    transforms: {},
    behaviors: {},
    groundTiles: {},
    lights: [],
    savedAt: new Date().toISOString(),
    ...state,
  }
  return {
    id: 'test-world-1',
    name: 'Test World',
    icon: '🌍',
    userId: 'local-user',
    data: JSON.stringify(base),
    objectCount: 0,
    visibility: 'private',
    thumbnailUrl: null,
    creatorName: null,
    creatorAvatar: null,
    visitCount: 0,
    updatedAt: new Date(),
    createdAt: new Date(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. DISPATCHER — unknown tool
// ═══════════════════════════════════════════════════════════════════════════

describe('callTool dispatcher', () => {
  it('returns ok:false for unknown tool name', async () => {
    const result = await callTool('unknown_tool', {})
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown tool')
    expect(result.message).toContain('unknown_tool')
  })

  it('includes available tool names in error message', async () => {
    const result = await callTool('nonexistent', {})
    expect(result.message).toContain('Available:')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. TOOL_NAMES
// ═══════════════════════════════════════════════════════════════════════════

describe('TOOL_NAMES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TOOL_NAMES)).toBe(true)
    expect(TOOL_NAMES.length).toBeGreaterThan(0)
  })

  it('contains only strings', () => {
    for (const name of TOOL_NAMES) {
      expect(typeof name).toBe('string')
    }
  })

  it('includes key tools', () => {
    expect(TOOL_NAMES).toContain('search_assets')
    expect(TOOL_NAMES).toContain('place_object')
    expect(TOOL_NAMES).toContain('set_avatar')
    expect(TOOL_NAMES).toContain('walk_avatar_to')
    expect(TOOL_NAMES).toContain('play_avatar_animation')
    expect(TOOL_NAMES).toContain('set_sky')
    expect(TOOL_NAMES).toContain('clear_world')
    expect(TOOL_NAMES).toContain('screenshot_viewport')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. search_assets — finds real catalog items
// ═══════════════════════════════════════════════════════════════════════════

describe('search_assets', () => {
  it('returns results for "tree" query', async () => {
    const result = await callTool('search_assets', { query: 'tree' })
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
    expect((result.data as unknown[]).length).toBeGreaterThan(0)
  })

  it('returns empty results for nonexistent query', async () => {
    const result = await callTool('search_assets', { query: 'zzz_nonexistent_xyz_999' })
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
    expect((result.data as unknown[]).length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. get_asset_catalog — returns categories
// ═══════════════════════════════════════════════════════════════════════════

describe('get_asset_catalog', () => {
  it('returns categories as object', async () => {
    const result = await callTool('get_asset_catalog', {})
    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('object')
    expect(result.data).not.toBeNull()
    // Should have at least one category
    const keys = Object.keys(result.data as Record<string, unknown>)
    expect(keys.length).toBeGreaterThan(0)
  })

  it('message mentions catalog size', async () => {
    const result = await callTool('get_asset_catalog', {})
    expect(result.message).toMatch(/\d+ assets/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. place_object — invalid assetId
// ═══════════════════════════════════════════════════════════════════════════

describe('place_object', () => {
  it('returns error for invalid assetId', async () => {
    const result = await callTool('place_object', { assetId: 'fake_nonexistent_id' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown asset')
  })

  it('succeeds with valid assetId when world exists', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('place_object', {
      assetId: 'antenna1',
      position: [1, 0, 2],
    })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Placed')
    expect(result.message).toContain('antenna1')
    expect(vi.mocked(prisma.world.update)).toHaveBeenCalled()
  })

  it('returns error when no world exists', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(null)

    const result = await callTool('place_object', { assetId: 'antenna1' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('No world found')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. set_sky — requires presetId
// ═══════════════════════════════════════════════════════════════════════════

describe('set_sky', () => {
  it('returns error without presetId', async () => {
    const result = await callTool('set_sky', {})
    expect(result.ok).toBe(false)
    expect(result.message).toContain('presetId is required')
  })

  it('succeeds with valid presetId and world', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('set_sky', { presetId: 'sunset' })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('sunset')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. paint_ground_tiles — empty tiles
// ═══════════════════════════════════════════════════════════════════════════

describe('paint_ground_tiles', () => {
  it('returns error with empty tiles array', async () => {
    const result = await callTool('paint_ground_tiles', { tiles: [] })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('tiles')
  })

  it('returns error when tiles is not provided', async () => {
    const result = await callTool('paint_ground_tiles', {})
    expect(result.ok).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. deliverScreenshot — no pending request
// ═══════════════════════════════════════════════════════════════════════════

describe('deliverScreenshot', () => {
  it('returns false when no pending screenshot request', () => {
    const result = deliverScreenshot('base64data')
    expect(result).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. isScreenshotPending
// ═══════════════════════════════════════════════════════════════════════════

describe('isScreenshotPending', () => {
  it('returns false by default', () => {
    expect(isScreenshotPending()).toBe(false)
  })

  it('stores structured screenshot requests and resolves multi-view captures', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      format: 'webp',
      quality: 0.88,
      width: 960,
      height: 540,
      views: [
        { id: 'front', mode: 'current' },
        {
          id: 'merlin-eye',
          mode: 'agent-avatar-phantom',
          agentType: 'merlin',
          distance: 1,
          heightOffset: 1.6,
          lookAhead: 6,
          fov: 100,
        },
      ],
    })

    expect(isScreenshotPending()).toBe(true)
    const request = getPendingScreenshotRequest()
    expect(request).not.toBeNull()
    expect(request?.format).toBe('webp')
    expect(request?.quality).toBe(0.88)
    expect(request?.width).toBe(960)
    expect(request?.height).toBe(540)
    expect(request?.views.map(view => view.id)).toEqual(['front', 'merlin-eye'])

    const delivered = deliverScreenshot([
      { viewId: 'front', base64: 'front-base64', format: 'webp' },
      { viewId: 'merlin-eye', base64: 'merlin-base64', format: 'webp' },
    ], request?.id)

    expect(delivered).toBe(true)

    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      format: 'webp',
      captureCount: 2,
      base64: 'front-base64',
      captures: [
        { viewId: 'front', format: 'webp', hasInlineBase64: true },
        { viewId: 'merlin-eye', format: 'webp', hasInlineBase64: true },
      ],
    })
    expect(isScreenshotPending()).toBe(false)
  })

  it('queues later screenshot requests instead of cancelling the first one', async () => {
    const firstPending = callTool('screenshot_viewport', {
      views: [{ id: 'agent-eye', mode: 'agent' }],
      defaultAgentType: 'merlin',
    })
    const secondPending = callTool('screenshot_viewport', {
      views: [{ id: 'overview', mode: 'external' }],
      defaultAgentType: 'merlin',
    })

    const firstRequest = getPendingScreenshotRequest()
    expect(firstRequest?.views[0]).toMatchObject({
      id: 'agent-eye',
      mode: 'agent-avatar-phantom',
      agentType: 'merlin',
    })

    expect(deliverScreenshot('first-base64', firstRequest?.id)).toBe(true)
    const firstResult = await firstPending
    expect(firstResult.ok).toBe(true)

    const secondRequest = getPendingScreenshotRequest()
    expect(secondRequest?.views[0]).toMatchObject({
      id: 'overview',
      mode: 'external-orbit',
      agentType: 'merlin',
    })

    expect(deliverScreenshot('second-base64', secondRequest?.id)).toBe(true)
    const secondResult = await secondPending
    expect(secondResult.ok).toBe(true)
    expect(isScreenshotPending()).toBe(false)
  })

  it('treats explicit agent camera coordinates as a literal look-at view', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      defaultAgentType: 'merlin',
      views: [{
        id: 'agent-self-shot',
        mode: 'agent',
        position: [0, 1.5, 3],
        target: [0, 1.5, 5],
        fov: 60,
      }],
    })

    const request = getPendingScreenshotRequest()
    expect(request?.views[0]).toMatchObject({
      id: 'agent-self-shot',
      mode: 'look-at',
      position: [0, 1.5, 3],
      target: [0, 1.5, 5],
      agentType: 'merlin',
      fov: 60,
    })

    expect(deliverScreenshot('look-at-base64', request?.id)).toBe(true)
    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(isScreenshotPending()).toBe(false)
  })

  it('normalizes third-person follow screenshots for embodied self-checks', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      defaultAgentType: 'merlin',
      views: [{
        id: 'merlin-tps',
        mode: 'third-person',
        agentType: 'merlin',
      }],
    })

    const request = getPendingScreenshotRequest()
    expect(request?.views[0]).toMatchObject({
      id: 'merlin-tps',
      mode: 'third-person-follow',
      agentType: 'merlin',
      fov: 72,
      distance: 4.4,
      heightOffset: 2.1,
      lookAhead: 4,
    })

    expect(deliverScreenshot('tps-base64', request?.id)).toBe(true)
    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(isScreenshotPending()).toBe(false)
  })

  it('builds a player avatar portrait via avatarpic_user', async () => {
    const pendingResult = callTool('avatarpic_user', {})

    const request = getPendingScreenshotRequest()
    expect(request?.views[0]).toMatchObject({
      id: 'player-portrait',
      mode: 'avatar-portrait',
      agentType: 'player',
      fov: 35,
      distance: 2.75,
      heightOffset: 1.55,
    })

    expect(deliverScreenshot('player-portrait-base64', request?.id)).toBe(true)
    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(isScreenshotPending()).toBe(false)
  })

  it('builds a third-person player avatar view via screenshot_avatar', async () => {
    const pendingResult = callTool('screenshot_avatar', {
      subject: 'player',
      style: 'third-person',
    })

    const request = getPendingScreenshotRequest()
    expect(request?.views[0]).toMatchObject({
      id: 'player-tps',
      mode: 'third-person-follow',
      agentType: 'player',
      fov: 72,
      distance: 4.4,
      heightOffset: 2.1,
      lookAhead: 4,
    })

    expect(deliverScreenshot('player-tps-base64', request?.id)).toBe(true)
    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(isScreenshotPending()).toBe(false)
  })

  it('rejects screenshot delivery for the wrong request id', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      views: [{ id: 'only', mode: 'current' }],
    })

    const request = getPendingScreenshotRequest()
    expect(request?.id).toBeTruthy()
    expect(deliverScreenshot('wrong-base64', 'wrong-request')).toBe(false)
    expect(isScreenshotPending()).toBe(true)

    const delivered = deliverScreenshot('real-base64', request?.id)
    expect(delivered).toBe(true)

    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ base64: 'real-base64' })
    expect(isScreenshotPending()).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. clear_world — requires confirm
// ═══════════════════════════════════════════════════════════════════════════

describe('clear_world', () => {
  it('returns error without confirm: true', async () => {
    const result = await callTool('clear_world', {})
    expect(result.ok).toBe(false)
    expect(result.message).toContain('confirm')
    expect(result.message).toContain('destructive')
  })

  it('succeeds with confirm: true and existing world', async () => {
    const world = makeWorldRow({
      catalogPlacements: [{ id: 'obj1', catalogId: 'antenna1', name: 'A', glbPath: '/x', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('clear_world', { confirm: true })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('cleared')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. remove_object — requires objectId
// ═══════════════════════════════════════════════════════════════════════════

describe('remove_object', () => {
  it('returns error without objectId', async () => {
    const result = await callTool('remove_object', {})
    expect(result.ok).toBe(false)
    expect(result.message).toContain('objectId is required')
  })

  it('returns error when object not found', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('remove_object', { objectId: 'nonexistent-id' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
  })
})

describe('agent avatar tools', () => {
  it('set_avatar creates a Hermes avatar in world state', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('set_avatar', {
      agent: 'hermes',
      avatarUrl: '/avatars/gallery/CoolAlien.vrm',
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('agent-avatar-hermes')
    expect(vi.mocked(prisma.world.update)).toHaveBeenCalled()
  })

  it('walk_avatar_to stores a move target for the avatar', async () => {
    const world = makeWorldRow({
      agentAvatars: [{
        id: 'agent-avatar-hermes',
        agentType: 'hermes',
        avatar3dUrl: '/avatars/gallery/CoolAlien.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1.15,
      }],
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('walk_avatar_to', {
      avatarId: 'agent-avatar-hermes',
      position: [4, 0, -2],
      speed: 5,
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('walking')
  })

  it('play_avatar_animation stores a behavior animation clip', async () => {
    const world = makeWorldRow({
      agentAvatars: [{
        id: 'agent-avatar-hermes',
        agentType: 'hermes',
        avatar3dUrl: '/avatars/gallery/CoolAlien.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1.15,
      }],
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('play_avatar_animation', {
      avatarId: 'agent-avatar-hermes',
      clipName: 'dance',
      loop: 'repeat',
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('dance')
  })
})

// ▓▓▓▓【O̸A̸S̸I̸S̸】▓▓▓▓ॐ▓▓▓▓【T̸E̸S̸T̸S̸】▓▓▓▓
