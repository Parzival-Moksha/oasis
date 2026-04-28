// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD SNAPSHOTS — Time travel for worlds
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET  /api/worlds/[id]/snapshots           — List snapshots
//   POST /api/worlds/[id]/snapshots           — Restore a snapshot
//   PUT  /api/worlds/[id]/snapshots           — Create manual snapshot
//
// ░▒▓█ NEVER LOSE A WORLD AGAIN █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { getOasisUserId } from '@/lib/session'
import { listSnapshots, restoreSnapshot, loadWorld } from '@/lib/forge/world-server'

type RouteContext = { params: Promise<{ id: string }> }

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/worlds/[id]/snapshots — List all snapshots for a world
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(request: Request, context: RouteContext) {
  try {
    const userId = await getOasisUserId(request)

    const { id } = await context.params
    const snapshots = await listSnapshots(id, userId)
    return NextResponse.json(snapshots)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Snapshots] GET error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/worlds/[id]/snapshots — Restore a snapshot
// Body: { snapshotId: string }
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: Request, context: RouteContext) {
  try {
    const userId = await getOasisUserId(request)

    const { id } = await context.params
    const { snapshotId } = await request.json() as { snapshotId: string }

    if (!snapshotId) {
      return NextResponse.json({ error: 'snapshotId required' }, { status: 400 })
    }

    const success = await restoreSnapshot(id, userId, snapshotId)
    if (!success) {
      return NextResponse.json({ error: 'Failed to restore snapshot' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, restored: snapshotId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Snapshots] POST error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/worlds/[id]/snapshots — Create a manual snapshot (user-triggered)
// ═══════════════════════════════════════════════════════════════════════════

export async function PUT(request: Request, context: RouteContext) {
  try {
    const userId = await getOasisUserId(request)

    const { id } = await context.params

    // Load current world state
    const worldState = await loadWorld(id, userId)
    if (!worldState) {
      return NextResponse.json({ error: 'World not found' }, { status: 404 })
    }

    const objectCount =
      (worldState.conjuredAssetIds?.length || 0) +
      (worldState.catalogPlacements?.length || 0) +
      (worldState.craftedScenes?.length || 0)

    const { prisma } = await import('@/lib/db')
    await prisma.worldSnapshot.create({
      data: {
        worldId: id,
        data: JSON.stringify(worldState),
        objectCount,
        source: 'manual',
      },
    })

    return NextResponse.json({ ok: true, object_count: objectCount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Snapshots] PUT error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
