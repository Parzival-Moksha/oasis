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
import { getRequiredOasisUserId } from '@/lib/session'
import { createManualSnapshot, listSnapshots, restoreSnapshot } from '@/lib/forge/world-server'
import { WorldAccessError } from '@/lib/forge/world-access'

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(err: unknown, label: string) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[Snapshots] ${label}:`, msg)
  if (err instanceof WorldAccessError) {
    return NextResponse.json({ error: msg, code: err.code }, { status: err.status })
  }
  return NextResponse.json({ error: msg }, { status: 500 })
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/worlds/[id]/snapshots — List all snapshots for a world
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params
    const snapshots = await listSnapshots(id, userId)
    return NextResponse.json(snapshots)
  } catch (err) {
    return errorResponse(err, 'GET error')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/worlds/[id]/snapshots — Restore a snapshot
// Body: { snapshotId: string }
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

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
    return errorResponse(err, 'POST error')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/worlds/[id]/snapshots — Create a manual snapshot (user-triggered)
// ═══════════════════════════════════════════════════════════════════════════

export async function PUT(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params

    const result = await createManualSnapshot(id, userId)
    if (!result) {
      return NextResponse.json({ error: 'World not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, object_count: result.objectCount })
  } catch (err) {
    return errorResponse(err, 'PUT error')
  }
}
