// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Per-World API
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET    /api/worlds/[id]  — Load world state
//   PUT    /api/worlds/[id]  — Save world state (debounced on client)
//   PATCH  /api/worlds/[id]  — Update world metadata (name, icon)
//   DELETE /api/worlds/[id]  — Delete world
//
// ░▒▓█ WORLD [ID] ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { getOasisUserId, getRequiredOasisUserId } from '@/lib/session'
import {
  loadWorld, saveWorld, deleteWorld, getRegistry, updateWorldMetadata,
  type WorldState,
} from '@/lib/forge/world-server'
import { WorldAccessError } from '@/lib/forge/world-access'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function errorResponse(err: unknown, label: string) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[Worlds] ${label}:`, msg)
  if (err instanceof WorldAccessError) {
    return NextResponse.json({ error: msg, code: err.code }, { status: err.status })
  }
  return NextResponse.json({ error: msg }, { status: 500 })
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/worlds/[id] — Load a single world's full state
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(request: Request, context: RouteContext) {
  try {
    const userId = await getOasisUserId(request)

    const { id } = await context.params
    const world = await loadWorld(id, userId)
    if (!world) {
      return NextResponse.json({ error: 'World not found' }, { status: 404 })
    }
    return NextResponse.json(world, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (err) {
    return errorResponse(err, 'GET [id] error')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/worlds/[id] — Save world state
// Body: Partial<WorldState> (version + savedAt added server-side)
// ═══════════════════════════════════════════════════════════════════════════

export async function PUT(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json()

    const state = body as Omit<WorldState, 'version' | 'savedAt'>

    const result = await saveWorld(id, userId, state)
    return NextResponse.json({ ok: true, ...result, savedAt: new Date().toISOString() })
  } catch (err) {
    return errorResponse(err, 'PUT [id] error')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/worlds/[id] — Update world metadata (name, icon)
// ═══════════════════════════════════════════════════════════════════════════

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json() as { name?: string; icon?: string }

    const updates: Record<string, string> = {}
    if (body.name?.trim()) updates.name = body.name.trim().slice(0, 50)
    if (body.icon) updates.icon = body.icon

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const ok = await updateWorldMetadata(id, userId, updates)
    if (!ok) {
      return NextResponse.json({ error: 'World not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, ...updates })
  } catch (err) {
    return errorResponse(err, 'PATCH [id] error')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/worlds/[id] — Delete world
// ═══════════════════════════════════════════════════════════════════════════

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params

    // Don't let user delete their last world
    const registry = await getRegistry(userId)
    if (registry.length <= 1) {
      return NextResponse.json({ error: 'Cannot delete your only world' }, { status: 400 })
    }

    await deleteWorld(id, userId)

    return NextResponse.json({ ok: true, deleted: id })
  } catch (err) {
    return errorResponse(err, 'DELETE [id] error')
  }
}

// ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【I̸D̸】▓▓▓▓ॐ▓▓▓▓【R̸O̸U̸T̸E̸】▓▓▓▓
