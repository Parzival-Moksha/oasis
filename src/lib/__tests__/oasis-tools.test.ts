// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS MCP TOOLS — Unit tests
// Tests: callTool dispatcher, TOOL_NAMES, search_assets, get_asset_catalog,
//        place_object, set_sky, paint_ground_tiles, remove_object,
//        clear_world, deliverScreenshot, isScreenshotPending
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
import { subscribe } from '../mcp/world-events'
import { prisma } from '../db'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const originalOasisMode = process.env.OASIS_MODE
const originalOasisProfile = process.env.OASIS_PROFILE

function makeWorldRow(state: Record<string, unknown> = {}, rowOverrides: Record<string, unknown> = {}) {
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
    ...rowOverrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.OASIS_MODE
  process.env.OASIS_PROFILE = 'local'
})

afterEach(() => {
  if (originalOasisMode === undefined) delete process.env.OASIS_MODE
  else process.env.OASIS_MODE = originalOasisMode
  if (originalOasisProfile === undefined) delete process.env.OASIS_PROFILE
  else process.env.OASIS_PROFILE = originalOasisProfile
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
    expect(TOOL_NAMES).toContain('list_avatar_animations')
    expect(TOOL_NAMES).toContain('play_avatar_animation')
    expect(TOOL_NAMES).toContain('get_craft_guide')
    expect(TOOL_NAMES).toContain('get_craft_job')
    expect(TOOL_NAMES).toContain('set_sky')
    expect(TOOL_NAMES).toContain('clear_world')
    expect(TOOL_NAMES).toContain('screenshot_viewport')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. search_assets — finds real catalog items
// ═══════════════════════════════════════════════════════════════════════════

describe('get_world_state', () => {
  it('reports effective catalog transforms from transform overrides', async () => {
    const world = makeWorldRow({
      catalogPlacements: [{
        id: 'console-1',
        catalogId: 'qs_prop_computer',
        name: 'Console',
        glbPath: '/x',
        position: [1, 0, 1],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      transforms: {
        'console-1': { position: [4, 0, 5], rotation: [0, 1.2, 0], scale: 1.5 },
      },
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)

    const result = await callTool('get_world_state', { worldId: 'test-world-1' })

    expect(result.ok).toBe(true)
    const data = result.data as { catalogObjects: Array<{ id: string; position: unknown; rotation: unknown; scale: unknown }> }
    expect(data.catalogObjects[0]).toMatchObject({
      id: 'console-1',
      position: [4, 0, 5],
      rotation: [0, 1.2, 0],
      scale: 1.5,
    })
  })
})

describe('query_objects', () => {
  it('uses effective positions and token matching across object names', async () => {
    const world = makeWorldRow({
      catalogPlacements: [{
        id: 'book-1',
        catalogId: 'qf_bookstand',
        name: 'Codex spell test bookstand',
        glbPath: '/x',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      craftedScenes: [{
        id: 'crafted-1',
        name: 'Codex MCP spell test sigil',
        objects: [],
        position: [2, 0, 2],
      }],
      transforms: {
        'book-1': { position: [9, 0, 9] },
      },
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)

    const result = await callTool('query_objects', { query: 'Codex spell test', near: [8, 0, 8], radius: 20 })

    expect(result.ok).toBe(true)
    const data = result.data as Array<{ id: string; type: string; position: unknown }>
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book-1', type: 'catalog', position: [9, 0, 9] }),
      expect.objectContaining({ id: 'crafted-1', type: 'crafted' }),
    ]))
  })
})

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

describe('conjure_asset', () => {
  it('defaults agent Meshy conjures to the textured refine tier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'conjure-test', status: 'queued', estimatedSeconds: 120 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await callTool('conjure_asset', {
        prompt: 'a brass owl statue',
        placeInWorld: false,
      })

      expect(result.ok).toBe(true)
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
      const body = JSON.parse(String(init?.body)) as { provider?: string; tier?: string }
      expect(body.provider).toBe('meshy')
      expect(body.tier).toBe('refine')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

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

describe('context-aware hosted world tools', () => {
  beforeEach(() => {
    process.env.OASIS_PROFILE = 'hosted-openclaw'
  })

  it('rejects relay mutations that do not carry an explicit worldId', async () => {
    const result = await callTool('place_object', { assetId: 'antenna1' }, {
      source: 'relay',
      userId: 'session-a',
      agentType: 'openclaw',
      requireExplicitWorld: true,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('explicit worldId')
    expect(result.data).toMatchObject({ code: 'tool_world_context_required', status: 400 })
    expect(vi.mocked(prisma.world.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects hosted relay writes to another user private world', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(makeWorldRow({}, {
      id: 'private-world',
      userId: 'session-b',
      visibility: 'private',
    }))

    const result = await callTool('place_object', { assetId: 'antenna1', worldId: 'private-world' }, {
      source: 'relay',
      userId: 'session-a',
      agentType: 'openclaw',
      worldId: 'private-world',
      requireExplicitWorld: true,
    })

    expect(result.ok).toBe(false)
    expect(result.data).toMatchObject({ code: 'world_write_forbidden' })
    expect(vi.mocked(prisma.world.update)).not.toHaveBeenCalled()
  })

  it('allows hosted relay writes to FFA worlds by non-owners', async () => {
    const world = makeWorldRow({}, {
      id: 'ffa-world',
      userId: 'session-b',
      visibility: 'public_edit',
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('place_object', { assetId: 'antenna1', worldId: 'ffa-world' }, {
      source: 'relay',
      userId: 'session-a',
      agentType: 'openclaw',
      worldId: 'ffa-world',
      requireExplicitWorld: true,
    })

    expect(result.ok).toBe(true)
    expect(vi.mocked(prisma.world.update).mock.calls[0]?.[0]?.where).toEqual({ id: 'ffa-world' })
  })

  it('forks template worlds before a hosted relay mutation', async () => {
    const template = makeWorldRow({}, {
      id: 'template-world',
      userId: 'system',
      name: 'Starter Template',
      visibility: 'template',
    })
    const fork = makeWorldRow({}, {
      id: 'fork-world',
      userId: 'session-a',
      name: 'Starter Template',
      visibility: 'private',
    })
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(template)
      .mockResolvedValueOnce(fork)
    vi.mocked(prisma.world.create).mockResolvedValue(fork)
    vi.mocked(prisma.world.update).mockResolvedValue(fork)
    const events: Array<{ type: string; worldId: string; data?: Record<string, unknown> }> = []
    const unsubscribe = subscribe(event => events.push(event))

    let result!: Awaited<ReturnType<typeof callTool>>
    try {
      result = await callTool('place_object', { assetId: 'antenna1', worldId: 'template-world' }, {
        source: 'relay',
        userId: 'session-a',
        agentType: 'openclaw',
        worldId: 'template-world',
        requireExplicitWorld: true,
      })
    } finally {
      unsubscribe()
    }

    expect(result.ok).toBe(true)
    expect(vi.mocked(prisma.world.create).mock.calls[0]?.[0]?.data).toMatchObject({
      userId: 'session-a',
      name: 'Starter Template',
      visibility: 'private',
    })
    expect(vi.mocked(prisma.world.update).mock.calls[0]?.[0]?.where).toEqual({ id: 'fork-world' })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'world_switch',
        worldId: 'template-world',
        data: expect.objectContaining({
          targetWorldId: 'fork-world',
          forkedFromWorldId: 'template-world',
          actorAgentType: 'openclaw',
        }),
      }),
    ]))
  })

  it('filters hosted list_worlds to owned and discoverable worlds', async () => {
    vi.mocked(prisma.world.findMany).mockResolvedValue([
      makeWorldRow({}, { id: 'owned-private', userId: 'session-a', visibility: 'private' }),
      makeWorldRow({}, { id: 'other-private', userId: 'session-b', visibility: 'private' }),
      makeWorldRow({}, { id: 'welcome-core', userId: 'system', visibility: 'core' }),
      makeWorldRow({}, { id: 'public-world', userId: 'session-b', visibility: 'public' }),
      makeWorldRow({}, { id: 'link-only', userId: 'session-b', visibility: 'unlisted' }),
    ])

    const result = await callTool('list_worlds', {}, {
      source: 'relay',
      userId: 'session-a',
      agentType: 'openclaw',
    })

    expect(result.ok).toBe(true)
    expect((result.data as Array<{ id: string }>).map(world => world.id)).toEqual([
      'owned-private',
      'welcome-core',
      'public-world',
    ])
    expect(vi.mocked(prisma.world.findMany).mock.calls[0]?.[0]?.where).toEqual({
      OR: [
        { userId: 'session-a' },
        { visibility: { in: ['core', 'template', 'ffa', 'public_edit', 'public'] } },
      ],
    })
  })
})

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

  it('uses top-level presetId as the tile preset fallback', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('paint_ground_tiles', {
      presetId: 'kn-cobblestone',
      tiles: [{ x: 1, z: 2 }, { x: 2, z: 2 }],
    })

    expect(result.ok).toBe(true)
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.groundTiles).toMatchObject({
      '1,2': 'kn-cobblestone',
      '2,2': 'kn-cobblestone',
    })
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
        { viewId: 'front', format: 'webp', base64: 'front-base64' },
        { viewId: 'merlin-eye', format: 'webp', base64: 'merlin-base64' },
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

  it('accepts lookat as an alias for explicit look-at screenshot views', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      defaultAgentType: 'hermes',
      views: [{
        id: 'side-angle',
        mode: 'lookat',
        cameraPosition: [5, 2.5, 40],
        cameraTarget: [1.64, 1, 38.08],
      }],
    })

    const request = getPendingScreenshotRequest()
    expect(request?.requesterAgentType).toBe('hermes')
    expect(request?.views[0]).toMatchObject({
      id: 'side-angle',
      mode: 'look-at',
      agentType: 'hermes',
      position: [5, 2.5, 40],
      target: [1.64, 1, 38.08],
    })

    expect(deliverScreenshot('lookat-alias-base64', request?.id)).toBe(true)
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
      fov: 45,
      distance: 2.75,
      heightOffset: 1.55,
    })

    expect(deliverScreenshot('player-portrait-base64', request?.id)).toBe(true)
    const result = await pendingResult
    expect(result.ok).toBe(true)
    expect(isScreenshotPending()).toBe(false)
  })

  it('defaults screenshot_avatar to the requester agent when defaultAgentType is provided', async () => {
    const pendingResult = callTool('screenshot_avatar', {
      defaultAgentType: 'hermes',
      worldId: 'world-hermes',
    })

    const request = getPendingScreenshotRequest({ worldId: 'world-hermes' })
    expect(request?.requesterAgentType).toBe('hermes')
    expect(request?.views[0]).toMatchObject({
      id: 'hermes-portrait',
      mode: 'avatar-portrait',
      agentType: 'hermes',
      distance: 2.75,
      heightOffset: 1.55,
    })

    expect(deliverScreenshot('hermes-portrait-base64', request?.id)).toBe(true)
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
      distance: 2.8,
      heightOffset: 1.6,
      lookAhead: 2.5,
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

  it('filters pending screenshot requests by world id when asked', async () => {
    const worldAPending = callTool('screenshot_viewport', {
      worldId: 'world-a',
      views: [{ id: 'world-a-view', mode: 'current' }],
    })
    const worldBPending = callTool('screenshot_viewport', {
      worldId: 'world-b',
      views: [{ id: 'world-b-view', mode: 'current' }],
    })

    expect(getPendingScreenshotRequest({ worldId: 'world-a' })).toMatchObject({
      worldId: 'world-a',
      views: [expect.objectContaining({ id: 'world-a-view' })],
      settleMs: 80,
    })
    expect(getPendingScreenshotRequest({ worldId: 'world-b' })).toMatchObject({
      worldId: 'world-b',
      views: [expect.objectContaining({ id: 'world-b-view' })],
      settleMs: 80,
    })

    expect(deliverScreenshot('world-a-base64', getPendingScreenshotRequest({ worldId: 'world-a' })?.id)).toBe(true)
    expect(deliverScreenshot('world-b-base64', getPendingScreenshotRequest({ worldId: 'world-b' })?.id)).toBe(true)

    await expect(worldAPending).resolves.toMatchObject({ ok: true })
    await expect(worldBPending).resolves.toMatchObject({ ok: true })
  })

  it('accepts the canonical "external-orbit" mode name', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      defaultAgentType: 'merlin',
      views: [{ id: 'canonical-overview', mode: 'external-orbit' }],
    })

    const request = getPendingScreenshotRequest()
    expect(request?.views[0]).toMatchObject({
      id: 'canonical-overview',
      mode: 'external-orbit',
      agentType: 'merlin',
    })

    expect(deliverScreenshot('canonical-overview-base64', request?.id)).toBe(true)
    await expect(pendingResult).resolves.toMatchObject({ ok: true })
    expect(isScreenshotPending()).toBe(false)
  })

  it('accepts "external" as an alias for external-orbit at the top level', async () => {
    const pendingResult = callTool('screenshot_viewport', {
      defaultAgentType: 'merlin',
      mode: 'external',
    })

    const request = getPendingScreenshotRequest()
    expect(request?.views[0]).toMatchObject({
      mode: 'external-orbit',
      agentType: 'merlin',
    })

    expect(deliverScreenshot('external-alias-base64', request?.id)).toBe(true)
    await expect(pendingResult).resolves.toMatchObject({ ok: true })
    expect(isScreenshotPending()).toBe(false)
  })

  it('returns a validation error for unknown modes instead of silently falling back', async () => {
    const result = await callTool('screenshot_viewport', {
      mode: 'garbage',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain("Invalid mode 'garbage'")
    expect(result.message).toContain('current')
    expect(result.message).toContain('agent-avatar-phantom')
    expect(result.message).toContain('look-at')
    expect(result.message).toContain('external-orbit')
    expect(result.message).toContain('third-person-follow')
    expect(result.message).toContain('avatar-portrait')
    expect(isScreenshotPending()).toBe(false)
  })

  it('rejects an unknown mode inside a views entry with a listing of valid values', async () => {
    const result = await callTool('screenshot_viewport', {
      views: [{ id: 'bad', mode: 'bird-eye' }],
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain("Invalid mode 'bird-eye'")
    expect(result.message).toContain('external-orbit')
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
      conjuredAssetIds: ['asset-123'],
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('clear_world', { confirm: true })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('cleared')
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.conjuredAssetIds).toEqual([])
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

  it('set_avatar repairs invalid avatar URLs instead of persisting broken ones', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('set_avatar', {
      agent: 'hermes',
      avatarUrl: '/avatars/hermes.glb#vrm',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Using Cool Alien')

    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.agentAvatars[0]?.avatar3dUrl).toBe('/avatars/gallery/CoolAlien.vrm')
  })

  it('set_avatar clears stale avatar transform overrides', async () => {
    const world = makeWorldRow({
      agentAvatars: [{
        id: 'agent-avatar-openclaw',
        agentType: 'openclaw',
        avatar3dUrl: '/avatars/gallery/CoolAlien.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      transforms: {
        'agent-avatar-openclaw': { position: [9, 0, -9], scale: 2 },
        'rock-1': { position: [1, 0, 1] },
      },
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('set_avatar', {
      agent: 'openclaw',
      avatarUrl: '/avatars/gallery/CoolAlien.vrm',
    })

    expect(result.ok).toBe(true)
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.agentAvatars[0]?.position).toEqual([9, 0, -9])
    expect(savedState.agentAvatars[0]?.scale).toBe(2)
    expect(savedState.transforms['agent-avatar-openclaw']).toBeUndefined()
    expect(savedState.transforms['rock-1']).toEqual({ position: [1, 0, 1] })
  })

  it('modify_object writes avatar transforms onto agentAvatars', async () => {
    const world = makeWorldRow({
      agentAvatars: [{
        id: 'agent-avatar-openclaw',
        agentType: 'openclaw',
        avatar3dUrl: '/avatars/gallery/CoolAlien.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      }],
      transforms: {
        'agent-avatar-openclaw': { position: [9, 0, -9] },
        'rock-1': { position: [1, 0, 1] },
      },
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('modify_object', {
      objectId: 'agent-avatar-openclaw',
      position: [3, 0, 4],
      rotation: [0, 2, 0],
      scale: 1.8,
    })

    expect(result.ok).toBe(true)
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.agentAvatars[0]?.position).toEqual([3, 0, 4])
    expect(savedState.agentAvatars[0]?.rotation).toEqual([0, 2, 0])
    expect(savedState.agentAvatars[0]?.scale).toBe(1.8)
    expect(savedState.transforms['agent-avatar-openclaw']).toBeUndefined()
    expect(savedState.transforms['rock-1']).toEqual({ position: [1, 0, 1] })
  })

  it('modify_object writes catalog transforms onto transform overrides', async () => {
    const world = makeWorldRow({
      catalogPlacements: [{
        id: 'console-1',
        catalogId: 'qs_prop_computer',
        name: 'Console',
        glbPath: '/x',
        position: [1, 0, 1],
        rotation: [0, 0, 0],
        scale: 1,
      }],
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('modify_object', {
      objectId: 'console-1',
      position: [3, 0, 4],
      rotation: [0, 1.1, 0],
      scale: [1.2, 1.3, 1.4],
    })

    expect(result.ok).toBe(true)
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.catalogPlacements[0]?.position).toEqual([1, 0, 1])
    expect(savedState.transforms['console-1']).toEqual({
      position: [3, 0, 4],
      rotation: [0, 1.1, 0],
      scale: [1.2, 1.3, 1.4],
    })
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
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.agentAvatars[0]?.position).toEqual([0, 0, 0])
  })

  it('walk_avatar_to clears stale looping avatar animations when movement starts', async () => {
    const world = makeWorldRow({
      agentAvatars: [{
        id: 'agent-avatar-hermes',
        agentType: 'hermes',
        avatar3dUrl: '/avatars/gallery/CoolAlien.vrm',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1.15,
      }],
      behaviors: {
        'agent-avatar-hermes': {
          visible: true,
          movement: { type: 'static' },
          animation: {
            clipName: 'lib:ual-capoeira',
            loop: 'repeat',
            speed: 1,
          },
        },
      },
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('walk_avatar_to', {
      avatarId: 'agent-avatar-hermes',
      position: [2, 0, 3],
    })

    expect(result.ok).toBe(true)
    const updatePayload = vi.mocked(prisma.world.update).mock.calls[0]?.[0]
    const savedState = JSON.parse(String(updatePayload?.data?.data || '{}'))
    expect(savedState.behaviors?.['agent-avatar-hermes']?.animation).toBeUndefined()
    expect(savedState.behaviors?.['agent-avatar-hermes']?.moveTarget).toEqual([2, 0, 3])
  })

  it('list_avatar_animations exposes exact supported clip ids', async () => {
    const result = await callTool('list_avatar_animations', {
      query: 'dance',
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      animations: expect.arrayContaining([
        expect.objectContaining({ id: 'ual-dance', clipName: 'lib:ual-dance' }),
      ]),
    })
  })

  it('list_avatar_animations treats category all as unfiltered', async () => {
    const result = await callTool('list_avatar_animations', {
      category: 'all',
      limit: 20,
    })

    expect(result.ok).toBe(true)
    const data = result.data as { animations: Array<{ id: string }> }
    expect(data.animations.length).toBeGreaterThan(0)
  })

  it('list_avatar_animations keeps raw spell queries broad while supporting aliases', async () => {
    const spellResult = await callTool('list_avatar_animations', {
      query: 'spell',
    })
    const conjureResult = await callTool('list_avatar_animations', {
      query: 'conjure',
    })

    expect(spellResult.ok).toBe(true)
    expect(conjureResult.ok).toBe(true)
    const spellData = spellResult.data as { animations: Array<{ id: string }> }
    const conjureData = conjureResult.data as { animations: Array<{ id: string }> }
    expect(spellData.animations.map(entry => entry.id)).toEqual(expect.arrayContaining([
      'ual-spell-idle',
      'ual-spell-shoot',
    ]))
    expect(conjureData.animations.map(entry => entry.id)).toContain('ual-spell-idle')
  })

  it('get_craft_guide exposes the self-crafting schema', async () => {
    const result = await callTool('get_craft_guide', {})

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      strategyDefault: 'agent',
      geometryTypes: expect.arrayContaining(['box', 'cylinder']),
      shaderTypes: expect.arrayContaining(['flame', 'crystal']),
      animationTypes: expect.arrayContaining(['rotate', 'bob']),
      example: expect.objectContaining({
        objects: expect.any(Array),
      }),
    })
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
    expect(result.message).toContain('ual-dance')
  })

  it('play_avatar_animation defaults to loop once when loop is omitted', async () => {
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
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      loop: 'once',
    })

    const updateArgs = vi.mocked(prisma.world.update).mock.calls[0]?.[0] as { data?: { data?: string } } | undefined
    const savedState = JSON.parse(updateArgs?.data?.data || '{}') as {
      behaviors?: Record<string, { animation?: { loop?: string } }>
    }
    expect(savedState.behaviors?.['agent-avatar-hermes']?.animation?.loop).toBe('once')
  })

  it('play_avatar_animation rejects unknown clip names with suggestions', async () => {
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

    const result = await callTool('play_avatar_animation', {
      avatarId: 'agent-avatar-hermes',
      clipName: 'wave',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown animation')
    expect(result.data).toMatchObject({
      requested: 'wave',
      suggestions: expect.any(Array),
    })
  })
})

describe('craft_scene prompt fallback', () => {
  it('defaults Hermes and Merlin to self-crafting unless sculptor fallback is explicit', async () => {
    const result = await callTool('craft_scene', {
      actorAgentType: 'hermes',
      prompt: 'a stone tower',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('self-crafted scenes')
    expect(result.message).toContain('strategy: "sculptor"')
  })

  it('defaults sculptor fallback to cc-opus and can complete via the craft stream', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"name":"Stone Tower","objects":[{"type":"box","position":[0,0.5,0],"scale":[1,1,1],"color":"#888888"}]}'))
          controller.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    ))

    const result = await callTool('craft_scene', {
      actorAgentType: 'merlin',
      prompt: 'a stone tower',
      strategy: 'sculptor',
      waitForCompletion: true,
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      status: 'completed',
      name: 'Stone Tower',
      objectCount: 1,
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/craft/cc'),
      expect.objectContaining({
        body: expect.stringContaining('"model":"cc-opus"'),
      }),
    )

    fetchSpy.mockRestore()
  })

  it('accepts self-crafted objects arrays passed as JSON strings', async () => {
    const world = makeWorldRow()
    vi.mocked(prisma.world.findFirst).mockResolvedValue(world)
    vi.mocked(prisma.world.update).mockResolvedValue(world)

    const result = await callTool('craft_scene', {
      actorAgentType: 'hermes',
      name: 'JSON scene',
      objects: JSON.stringify([
        { type: 'box', position: [0, 0.5, 0], scale: [1, 1, 1], color: '#888888' },
      ]),
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('JSON scene')
  })
})

// ▓▓▓▓【O̸A̸S̸I̸S̸】▓▓▓▓ॐ▓▓▓▓【T̸E̸S̸T̸S̸】▓▓▓▓
