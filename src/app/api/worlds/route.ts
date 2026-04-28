// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — World Persistence API
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET  /api/worlds        — List all worlds for current user
//   POST /api/worlds        — Create new world / import
//
// ░▒▓█ WORLDS ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { getOasisUserId } from '@/lib/session'
import {
  getRegistry, createWorld, saveWorld,
  type WorldState,
} from '@/lib/forge/world-server'

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/worlds — All worlds for the authenticated user
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(request: Request) {
  try {
    const userId = await getOasisUserId(request)

    const registry = await getRegistry(userId)
    return NextResponse.json(registry)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Worlds] GET error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/worlds — Create a new world OR import one
//
// Body (create):  { name: string, icon?: string }
// Body (import):  { import: true, meta?: WorldMeta, state: WorldState }
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const userId = await getOasisUserId(request)
    const body = await request.json()

    // ░▒▓ Import path ▓▒░
    if (body.import && body.state) {
      const state = body.state as WorldState
      if (state.version !== 1) {
        return NextResponse.json({ error: 'Invalid world version' }, { status: 400 })
      }
      const name = body.meta?.name || 'Imported World'
      const icon = body.meta?.icon || '📦'
      const meta = await createWorld(name, icon, userId)
      await saveWorld(meta.id, userId, {
        terrain: state.terrain,
        craftedScenes: state.craftedScenes || [],
        conjuredAssetIds: state.conjuredAssetIds || [],
        catalogPlacements: state.catalogPlacements || [],
        transforms: state.transforms || {},
        behaviors: state.behaviors,
        groundPresetId: state.groundPresetId,
        groundTiles: state.groundTiles,
        lights: state.lights,
        skyBackgroundId: state.skyBackgroundId,
        agentWindows: state.agentWindows || [],
        agentAvatars: state.agentAvatars || [],
      })
      return NextResponse.json(meta, { status: 201 })
    }

    // ░▒▓ Create path ▓▒░
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'Missing "name" field' }, { status: 400 })
    }

    const meta = await createWorld(body.name, body.icon || '🌍', userId)
    return NextResponse.json(meta, { status: 201 })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Worlds] POST error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ▓▓▓▓【W̸O̸R̸L̸D̸S̸】▓▓▓▓ॐ▓▓▓▓【R̸O̸U̸T̸E̸】▓▓▓▓
