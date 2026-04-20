import 'server-only'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'

import { OASIS_MCP_TOOL_SPECS } from '@/lib/mcp/oasis-tool-spec.js'
import { buildOasisOpenclawMcpDefinition } from '@/lib/openclaw-runtime-config'

export type OpenclawSmokeMode = 'core' | 'live' | 'external'
export type OpenclawSmokeCategory = 'transport' | 'world' | 'avatar' | 'craft' | 'live-bridge' | 'conjure'
export type OpenclawSmokeStatus = 'passed' | 'failed' | 'skipped'

export interface OpenclawSmokeTestCase {
  name: string
  toolName?: string
  category: OpenclawSmokeCategory
  status: OpenclawSmokeStatus
  detail: string
  args?: Record<string, unknown>
  data?: unknown
  durationMs?: number
}

export interface OpenclawSmokeReport {
  mode: OpenclawSmokeMode
  startedAt: number
  finishedAt: number
  durationMs: number
  endpoint: string
  worldId?: string
  worldName?: string
  counts: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
  tests: OpenclawSmokeTestCase[]
}

interface OpenclawSmokeOptions {
  liveWorldId?: string
}

interface ToolResultShape {
  ok: boolean
  message: string
  data?: unknown
}

interface SmokeRuntimeState {
  worldId: string
  worldName: string
  placedObjectId: string
  craftedSceneId: string
  lightId: string
  avatarId: string
  animationClip: string
  listedConjuredAssetId: string
}

const SMOKE_ASSET_ID = 'prop_crate'
const SMOKE_AVATAR_URL = '/avatars/gallery/Crustybutt_da_king.vrm'

function summarizeForReport(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 2) {
    if (Array.isArray(value)) return `[array(${value.length})]`
    if (typeof value === 'object') return '[object]'
    return value
  }

  if (typeof value === 'string') {
    return value.length > 280 ? `${value.slice(0, 277)}...` : value
  }

  if (Array.isArray(value)) {
    if (value.length <= 6) return value.map(entry => summarizeForReport(entry, depth + 1))
    return {
      count: value.length,
      sample: value.slice(0, 3).map(entry => summarizeForReport(entry, depth + 1)),
    }
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const limited = entries.slice(0, 12).map(([key, entryValue]) => [key, summarizeForReport(entryValue, depth + 1)])
    if (entries.length <= limited.length) {
      return Object.fromEntries(limited)
    }
    return {
      ...Object.fromEntries(limited),
      _truncatedKeys: entries.length - limited.length,
    }
  }

  return value
}

function countStatuses(tests: OpenclawSmokeTestCase[]) {
  return tests.reduce(
    (acc, test) => {
      acc.total += 1
      if (test.status === 'passed') acc.passed += 1
      if (test.status === 'failed') acc.failed += 1
      if (test.status === 'skipped') acc.skipped += 1
      return acc
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  )
}

function normalizeToolResult(raw: unknown): ToolResultShape {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    const structured = record.structuredContent
    if (structured && typeof structured === 'object') {
      const candidate = structured as Record<string, unknown>
      if (typeof candidate.ok === 'boolean' && typeof candidate.message === 'string') {
        return {
          ok: candidate.ok,
          message: candidate.message,
          ...(candidate.data !== undefined ? { data: candidate.data } : {}),
        }
      }
    }

    const content = Array.isArray(record.content) ? record.content : []
    const firstText = content.find(
      entry => entry && typeof entry === 'object' && (entry as Record<string, unknown>).type === 'text' && typeof (entry as Record<string, unknown>).text === 'string',
    ) as { text?: string } | undefined

    if (firstText?.text) {
      try {
        const parsed = JSON.parse(firstText.text) as Record<string, unknown>
        if (typeof parsed.ok === 'boolean' && typeof parsed.message === 'string') {
          return {
            ok: parsed.ok,
            message: parsed.message,
            ...(parsed.data !== undefined ? { data: parsed.data } : {}),
          }
        }
      } catch {
        // Fall through to generic formatting.
      }
    }

    return {
      ok: record.isError !== true,
      message: typeof firstText?.text === 'string' ? firstText.text : 'Tool call returned an unexpected payload.',
      data: raw,
    }
  }

  return {
    ok: false,
    message: 'Tool call returned no structured result.',
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function runOpenclawSmoke(
  baseUrl: string,
  mode: OpenclawSmokeMode = 'core',
  options: OpenclawSmokeOptions = {},
): Promise<OpenclawSmokeReport> {
  const startedAt = Date.now()
  const definition = buildOasisOpenclawMcpDefinition(baseUrl)
  const endpoint = definition.url
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: definition.headers ? { headers: definition.headers } : undefined,
  })
  const client = new Client({
    name: 'oasis-openclaw-smoke',
    version: '1.0.0',
  })
  const tests: OpenclawSmokeTestCase[] = []
  const state: SmokeRuntimeState = {
    worldId: '',
    worldName: '',
    placedObjectId: '',
    craftedSceneId: '',
    lightId: '',
    avatarId: '',
    animationClip: '',
    listedConjuredAssetId: '',
  }
  const requestedLiveWorldId = typeof options.liveWorldId === 'string' ? options.liveWorldId.trim() : ''

  const record = (entry: OpenclawSmokeTestCase) => {
    tests.push(entry)
  }

  const finish = (): OpenclawSmokeReport => {
    const finishedAt = Date.now()
    return {
      mode,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      endpoint,
      ...(state.worldId ? { worldId: state.worldId } : {}),
      ...(state.worldName ? { worldName: state.worldName } : {}),
      counts: countStatuses(tests),
      tests,
    }
  }

  const skip = (name: string, category: OpenclawSmokeCategory, detail: string, toolName?: string) => {
    record({
      name,
      category,
      status: 'skipped',
      detail,
      ...(toolName ? { toolName } : {}),
    })
  }

  const callTool = async (toolName: string, args: Record<string, unknown> = {}) => {
    const raw = await client.request({
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }, CallToolResultSchema)
    return normalizeToolResult(raw)
  }

  const runTool = async (
    name: string,
    category: OpenclawSmokeCategory,
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      onSuccess?: (result: ToolResultShape) => void
    },
  ) => {
    const stepStartedAt = Date.now()
    try {
      const result = await callTool(toolName, args)
      record({
        name,
        toolName,
        category,
        status: result.ok ? 'passed' : 'failed',
        detail: result.message,
        args,
        ...(result.data !== undefined ? { data: summarizeForReport(result.data) } : {}),
        durationMs: Date.now() - stepStartedAt,
      })
      if (result.ok) {
        options?.onSuccess?.(result)
      }
      return result
    } catch (error) {
      record({
        name,
        toolName,
        category,
        status: 'failed',
        detail: summarizeError(error),
        args,
        durationMs: Date.now() - stepStartedAt,
      })
      return null
    }
  }

  try {
    await client.connect(transport)

    const toolListStartedAt = Date.now()
    try {
      const listed = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const listedNames = new Set(listed.tools.map(tool => tool.name))
      const expectedNames = OASIS_MCP_TOOL_SPECS.map(spec => spec.name)
      const missing = expectedNames.filter(name => !listedNames.has(name))
      const unexpected = listed.tools
        .map(tool => tool.name)
        .filter(name => !expectedNames.includes(name))

      record({
        name: 'MCP transport connects and lists Oasis tools',
        category: 'transport',
        status: missing.length === 0 ? 'passed' : 'failed',
        detail: missing.length === 0
          ? `Listed ${listed.tools.length} tools through the live MCP endpoint.`
          : `Missing ${missing.length} expected tools: ${missing.join(', ')}`,
        data: summarizeForReport({
          listedCount: listed.tools.length,
          missing,
          unexpected,
        }),
        durationMs: Date.now() - toolListStartedAt,
      })
    } catch (error) {
      record({
        name: 'MCP transport connects and lists Oasis tools',
        category: 'transport',
        status: 'failed',
        detail: summarizeError(error),
        durationMs: Date.now() - toolListStartedAt,
      })
    }

    if (mode === 'live') {
      if (!requestedLiveWorldId) {
        skip('Capture the current viewport', 'live-bridge', 'Live smoke needs the currently open Oasis world id from the browser panel.', 'screenshot_viewport')
        skip('Capture the OpenClaw avatar portrait', 'live-bridge', 'Live smoke needs the currently open Oasis world id from the browser panel.', 'screenshot_avatar')
        skip('Capture the Merlin avatar portrait', 'live-bridge', 'Live smoke needs the currently open Oasis world id from the browser panel.', 'avatarpic_merlin')
        skip('Capture the user avatar portrait', 'live-bridge', 'Live smoke needs the currently open Oasis world id from the browser panel.', 'avatarpic_user')
        return finish()
      }

      state.worldId = requestedLiveWorldId

      let hasOpenclawAvatar = false
      let hasMerlinAvatar = false

      await runTool('Read the current browser world info for live smoke', 'world', 'get_world_info', { worldId: requestedLiveWorldId }, {
        onSuccess: result => {
          const data = result.data as { worldId?: string; name?: string } | undefined
          if (typeof data?.worldId === 'string' && data.worldId) state.worldId = data.worldId
          if (typeof data?.name === 'string' && data.name) state.worldName = data.name
        },
      })

      await runTool('Inspect live-world avatars before screenshot smoke', 'world', 'get_world_state', { worldId: state.worldId }, {
        onSuccess: result => {
          const data = result.data as { agentAvatars?: Array<{ agentType?: string }> } | undefined
          const avatars = Array.isArray(data?.agentAvatars) ? data.agentAvatars : []
          hasOpenclawAvatar = avatars.some(entry => typeof entry?.agentType === 'string' && entry.agentType.toLowerCase() === 'openclaw')
          hasMerlinAvatar = avatars.some(entry => typeof entry?.agentType === 'string' && entry.agentType.toLowerCase() === 'merlin')
        },
      })

      await runTool('Capture the current viewport', 'live-bridge', 'screenshot_viewport', {
        worldId: state.worldId,
        mode: 'current',
        width: 480,
        height: 270,
        quality: 0.72,
      })

      if (hasOpenclawAvatar) {
        await runTool('Capture the OpenClaw avatar portrait', 'live-bridge', 'screenshot_avatar', {
          worldId: state.worldId,
          subject: 'openclaw',
          style: 'portrait',
          width: 480,
          height: 480,
        })
      } else {
        skip('Capture the OpenClaw avatar portrait', 'live-bridge', 'Skipped because the current live world does not have an OpenClaw avatar yet.', 'screenshot_avatar')
      }

      if (hasMerlinAvatar) {
        await runTool('Capture the Merlin avatar portrait', 'live-bridge', 'avatarpic_merlin', {
          worldId: state.worldId,
          style: 'portrait',
          width: 420,
          height: 420,
        })
      } else {
        skip('Capture the Merlin avatar portrait', 'live-bridge', 'Skipped because the current live world does not have a Merlin avatar yet.', 'avatarpic_merlin')
      }

      await runTool('Capture the user avatar portrait', 'live-bridge', 'avatarpic_user', {
        worldId: state.worldId,
        style: 'portrait',
        width: 420,
        height: 420,
      })

      return finish()
    }

    const worldStamp = new Date().toISOString().replace(/[:.]/g, '-')
    await runTool(
      'Create a scratch smoke-test world',
      'world',
      'create_world',
      { name: `OpenClaw Smoke ${worldStamp}`, icon: '🧪' },
      {
        onSuccess: result => {
          const data = result.data as { worldId?: string; name?: string } | undefined
          state.worldId = typeof data?.worldId === 'string' ? data.worldId : state.worldId
          state.worldName = typeof data?.name === 'string' ? data.name : state.worldName
        },
      },
    )

    const worldId = state.worldId
    const worldArgs = worldId ? { worldId } : {}

    await runTool('List saved worlds', 'world', 'list_worlds', {})
    await runTool('Load the scratch smoke-test world', 'world', 'load_world', worldArgs)
    await runTool('Read world info from the scratch world', 'world', 'get_world_info', worldArgs)
    await runTool('Read full world state from the scratch world', 'world', 'get_world_state', worldArgs)
    await runTool('Read the asset catalog', 'world', 'get_asset_catalog', {})
    await runTool('Search assets for a known smoke-test crate', 'world', 'search_assets', { query: 'crate', limit: 5 })

    await runTool(
      'Place a catalog object into the scratch world',
      'world',
      'place_object',
      {
        ...worldArgs,
        assetId: SMOKE_ASSET_ID,
        position: [0, 0, 0],
        rotation: [0, 0.2, 0],
        scale: 2,
        label: 'Smoke Crate',
      },
      {
        onSuccess: result => {
          const data = result.data as { id?: string } | undefined
          state.placedObjectId = typeof data?.id === 'string' ? data.id : state.placedObjectId
        },
      },
    )

    await runTool('Query objects in the scratch world', 'world', 'query_objects', {
      ...worldArgs,
      query: 'smoke',
      type: 'catalog',
    })

    if (state.placedObjectId) {
      await runTool('Modify the placed smoke object', 'world', 'modify_object', {
        ...worldArgs,
        objectId: state.placedObjectId,
        position: [0.4, 0, 0.2],
        rotation: [0, 0.6, 0],
        scale: 2.2,
        label: 'Smoke Crate Prime',
      })
    } else {
      skip('Modify the placed smoke object', 'world', 'Skipped because no catalog object was placed successfully.', 'modify_object')
    }

    await runTool('Set the scratch world sky preset', 'world', 'set_sky', {
      ...worldArgs,
      presetId: 'dawn',
    })
    await runTool('Set the scratch world ground preset', 'world', 'set_ground_preset', {
      ...worldArgs,
      presetId: 'sand',
    })
    await runTool('Paint a couple of scratch-world ground tiles', 'world', 'paint_ground_tiles', {
      ...worldArgs,
      tiles: [
        { x: 0, z: 0, presetId: 'stone' },
        { x: 1, z: 0, presetId: 'grass' },
      ],
    })

    await runTool(
      'Add a smoke-test point light',
      'world',
      'add_light',
      {
        ...worldArgs,
        type: 'point',
        position: [0, 3, 0],
        color: '#7dd3fc',
        intensity: 2.5,
        label: 'Smoke Light',
      },
      {
        onSuccess: result => {
          const data = result.data as { id?: string } | undefined
          state.lightId = typeof data?.id === 'string' ? data.id : state.lightId
        },
      },
    )

    if (state.lightId) {
      await runTool('Modify the smoke-test light', 'world', 'modify_light', {
        ...worldArgs,
        lightId: state.lightId,
        position: [0.8, 3.4, 0.4],
        color: '#f0abfc',
        intensity: 3.2,
        visible: true,
      })
    } else {
      skip('Modify the smoke-test light', 'world', 'Skipped because no light was added successfully.', 'modify_light')
    }

    if (state.placedObjectId) {
      await runTool('Set a behavior on the smoke-test object', 'world', 'set_behavior', {
        ...worldArgs,
        objectId: state.placedObjectId,
        movement: 'spin',
        speed: 0.9,
      })
    } else {
      skip('Set a behavior on the smoke-test object', 'world', 'Skipped because no catalog object was placed successfully.', 'set_behavior')
    }

    await runTool(
      'Set the OpenClaw avatar in the scratch world',
      'avatar',
      'set_avatar',
      {
        ...worldArgs,
        agentType: 'openclaw',
        avatarUrl: SMOKE_AVATAR_URL,
        position: [1.2, 0, 0.8],
        rotation: [0, Math.PI * 0.82, 0],
        scale: 1.15,
        label: 'Smoke Claw',
      },
      {
        onSuccess: result => {
          const data = result.data as { id?: string; avatarId?: string } | undefined
          state.avatarId =
            (typeof data?.avatarId === 'string' && data.avatarId)
            || (typeof data?.id === 'string' && data.id)
            || state.avatarId
        },
      },
    )

    const animationList = await runTool(
      'List supported avatar animations',
      'avatar',
      'list_avatar_animations',
      { query: 'talk', limit: 8 },
      {
        onSuccess: result => {
          const data = result.data as { animations?: Array<{ clipName?: string }> } | undefined
          const firstClip = data?.animations?.find(entry => typeof entry.clipName === 'string')?.clipName
          if (firstClip) state.animationClip = firstClip
        },
      },
    )

    if (!state.animationClip && animationList?.ok) {
      const fallbackAnimations = (animationList.data as { animations?: Array<{ clipName?: string }> } | undefined)?.animations || []
      const firstClip = fallbackAnimations.find(entry => typeof entry.clipName === 'string')?.clipName
      if (firstClip) state.animationClip = firstClip
    }

    if (state.avatarId && state.animationClip) {
      await runTool('Play an avatar animation on OpenClaw', 'avatar', 'play_avatar_animation', {
        ...worldArgs,
        avatarId: state.avatarId,
        clipName: state.animationClip,
        loop: 'once',
        speed: 1,
      })
      await runTool('Walk the OpenClaw avatar to a nearby point', 'avatar', 'walk_avatar_to', {
        ...worldArgs,
        avatarId: state.avatarId,
        position: [1.8, 0, 1.1],
        speed: 2.8,
      })
    } else {
      skip('Play an avatar animation on OpenClaw', 'avatar', 'Skipped because the smoke avatar or animation clip was not available.', 'play_avatar_animation')
      skip('Walk the OpenClaw avatar to a nearby point', 'avatar', 'Skipped because the smoke avatar was not available.', 'walk_avatar_to')
    }

    await runTool('Read the self-craft guide', 'craft', 'get_craft_guide', {})
    await runTool(
      'Craft a direct self-authored object cluster',
      'craft',
      'craft_scene',
      {
        ...worldArgs,
        name: 'Smoke Pearl Shrine',
        position: [2.2, 0, 0.4],
        objects: [
          { type: 'sphere', position: [0, 0.5, 0], scale: [0.45, 0.45, 0.45], color: '#f8fafc', roughness: 0.15, metalness: 0.05 },
          { type: 'glow_orb', position: [0, 0.5, 0], scale: [0.7, 0.7, 0.7], color: '#67e8f9', color2: '#c084fc', intensity: 0.8, speed: 0.4 },
          { type: 'cylinder', position: [0, 0.12, 0], scale: [0.62, 0.12, 0.62], color: '#334155', roughness: 0.8 },
        ],
      },
      {
        onSuccess: result => {
          const data = result.data as { id?: string } | undefined
          state.craftedSceneId = typeof data?.id === 'string' ? data.id : state.craftedSceneId
        },
      },
    )

    if (state.craftedSceneId) {
      await runTool('Remove the crafted smoke object', 'craft', 'remove_object', {
        ...worldArgs,
        objectId: state.craftedSceneId,
      })
    } else {
      skip('Remove the crafted smoke object', 'craft', 'Skipped because the crafted scene did not return an ID.', 'remove_object')
    }

    const conjuredAssets = await runTool('List conjured assets already known to Oasis', 'conjure', 'list_conjured_assets', {
      ...worldArgs,
      limit: 10,
    }, {
      onSuccess: result => {
        const data = result.data as { assets?: Array<{ id?: string }> } | undefined
        const firstId = data?.assets?.find(entry => typeof entry.id === 'string')?.id
        if (firstId) state.listedConjuredAssetId = firstId
      },
    })

    if (!state.listedConjuredAssetId && conjuredAssets?.ok) {
      const data = conjuredAssets.data as { assets?: Array<{ id?: string }> } | undefined
      const firstId = data?.assets?.find(entry => typeof entry.id === 'string')?.id
      if (firstId) state.listedConjuredAssetId = firstId
    }

    if (state.listedConjuredAssetId) {
      await runTool('Read an existing conjured asset record', 'conjure', 'get_conjured_asset', {
        ...worldArgs,
        assetId: state.listedConjuredAssetId,
      })
      await runTool('Place an existing conjured asset into the scratch world', 'conjure', 'place_conjured_asset', {
        ...worldArgs,
        assetId: state.listedConjuredAssetId,
        position: [3.2, 0, 0.6],
        scale: 1,
      })
      await runTool('Remove the placed conjured asset from the scratch world only', 'conjure', 'delete_conjured_asset', {
        ...worldArgs,
        assetId: state.listedConjuredAssetId,
        deleteRegistry: false,
      })
    } else {
      skip('Read an existing conjured asset record', 'conjure', 'Skipped because Oasis has no existing conjured assets in its registry yet.', 'get_conjured_asset')
      skip('Place an existing conjured asset into the scratch world', 'conjure', 'Skipped because Oasis has no existing conjured assets in its registry yet.', 'place_conjured_asset')
      skip('Remove the placed conjured asset from the scratch world only', 'conjure', 'Skipped because Oasis has no existing conjured assets in its registry yet.', 'delete_conjured_asset')
    }

    skip('Capture the current viewport', 'live-bridge', 'Skipped here because live screenshot smoke now runs against the world currently open in the Oasis browser.', 'screenshot_viewport')
    skip('Capture the OpenClaw avatar portrait', 'live-bridge', 'Skipped here because live screenshot smoke now runs against the world currently open in the Oasis browser.', 'screenshot_avatar')
    skip('Capture the Merlin avatar portrait', 'live-bridge', 'Skipped here because live screenshot smoke now runs against the world currently open in the Oasis browser.', 'avatarpic_merlin')
    skip('Capture the user avatar portrait', 'live-bridge', 'Skipped here because live screenshot smoke now runs against the world currently open in the Oasis browser.', 'avatarpic_user')

    if (mode === 'external') {
      skip('Prompt-craft a remote scene job', 'craft', 'Skipped by default because prompt craft consumes model calls. Add a dedicated external smoke pass if you want this automated.', 'craft_scene')
      skip('Poll a prompt-craft job', 'craft', 'Skipped by default because prompt craft consumes model calls.', 'get_craft_job')
      skip('Start a new conjuration', 'conjure', 'Skipped by default because conjuration can spend provider credits.', 'conjure_asset')
      skip('Post-process a conjured asset', 'conjure', 'Skipped by default because it requires a generated asset and can spend provider credits.', 'process_conjured_asset')
    } else {
      skip('Prompt-craft a remote scene job', 'craft', 'Skipped in core mode because prompt craft consumes model calls.', 'craft_scene')
      skip('Poll a prompt-craft job', 'craft', 'Skipped in core mode because prompt craft consumes model calls.', 'get_craft_job')
      skip('Start a new conjuration', 'conjure', 'Skipped in core mode because conjuration can spend provider credits.', 'conjure_asset')
      skip('Post-process a conjured asset', 'conjure', 'Skipped in core mode because it requires a generated asset and can spend provider credits.', 'process_conjured_asset')
    }

    await runTool('Clear the scratch smoke-test world', 'world', 'clear_world', {
      ...worldArgs,
      confirm: true,
    })
    await runTool('Confirm the scratch world is empty again', 'world', 'get_world_info', worldArgs)
  } finally {
    await transport.close().catch(() => {})
  }

  return finish()
}
