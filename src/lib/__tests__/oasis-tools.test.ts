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

import { callTool, TOOL_NAMES, deliverScreenshot, isScreenshotPending } from '../mcp/oasis-tools'
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
