// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Conjure Asset Route (per-ID)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════╗
//   ║  GET    /api/conjure/[id]  — Observe a single conjuration     ║
//   ║  DELETE /api/conjure/[id]  — Banish it back to the void       ║
//   ║                                                               ║
//   ║  Every created thing deserves to be witnessed.                ║
//   ║  And every created thing can be unmade.                       ║
//   ║  Such is the duality of The Forge.                            ║
//   ╚═══════════════════════════════════════════════════════════════╝
//
// ░▒▓█ CONJURE ASSET ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { getAssetById, removeAsset, updateAsset } from '@/lib/conjure/registry'

// ░▒▓ NEVER cache this route — client polls for real-time progress ▓▒░
export const dynamic = 'force-dynamic'

function parseFiniteVector3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const coords = value.slice(0, 3).map(Number)
  if (!coords.every(Number.isFinite)) return null
  return [coords[0], coords[1], coords[2]]
}

function parseFiniteScale(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/conjure/[id] — Observe a single conjuration
//
// Returns the full ConjuredAsset including current status and progress.
// The client polls this to watch the forge in action.
//
// Like watching through the furnace glass as metal takes shape.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const asset = getAssetById(id)
    if (!asset) {
      return NextResponse.json(
        { error: `Asset "${id}" not found. Perhaps it was never conjured, or has been banished.` },
        { status: 404 },
      )
    }

    return NextResponse.json({ asset })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge] GET /api/conjure/[id] error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/conjure/[id] — Rename or update user-editable fields
//
// Body: { displayName?: string, position?: [x,y,z], rotation?: [x,y,z], scale?: number }
// The gentle art of naming and placement — every creation deserves a proper name and a home.
// ═══════════════════════════════════════════════════════════════════════════

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()

    const asset = getAssetById(id)
    if (!asset) {
      return NextResponse.json(
        { error: `Asset "${id}" not found.` },
        { status: 404 },
      )
    }

    // ░▒▓ Only allow safe user-editable fields ▓▒░
    const allowedUpdates: Record<string, unknown> = {}
    if (typeof body.displayName === 'string') {
      allowedUpdates.displayName = body.displayName.trim().slice(0, 100)
    }
    const position = parseFiniteVector3(body.position)
    if (position) {
      allowedUpdates.position = position
    }
    const rotation = parseFiniteVector3(body.rotation)
    if (rotation) {
      allowedUpdates.rotation = rotation
    }
    const scale = parseFiniteScale(body.scale)
    if (scale !== null) {
      allowedUpdates.scale = scale
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 },
      )
    }

    const updated = updateAsset(id, allowedUpdates)
    console.log(`[Forge] Asset ${id} updated:`, Object.keys(allowedUpdates).join(', '))

    return NextResponse.json({ asset: updated })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge] PATCH /api/conjure/[id] error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/conjure/[id] — Banish a conjuration
//
// Removes the asset from the registry AND deletes the GLB file from disk.
// Once banished, the geometry returns to the formless void.
//
// A mother knows that sometimes, you must let go.
// ═══════════════════════════════════════════════════════════════════════════

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // ░▒▓ Check if the asset exists before banishing ▓▒░
    const asset = getAssetById(id)
    if (!asset) {
      return NextResponse.json(
        { error: `Asset "${id}" not found. Cannot banish what does not exist.` },
        { status: 404 },
      )
    }

    // ░▒▓ Delete the GLB file from public/conjured/ if it exists ▓▒░
    const glbPath = join(process.cwd(), 'public', 'conjured', `${id}.glb`)
    if (existsSync(glbPath)) {
      unlinkSync(glbPath)
      console.log(`[Forge] Deleted GLB file: ${glbPath}`)
    }

    // ░▒▓ Remove from registry ▓▒░
    const removed = removeAsset(id)
    if (!removed) {
      // Shouldn't happen since we checked above, but be defensive
      return NextResponse.json(
        { error: `Failed to remove asset "${id}" from registry` },
        { status: 500 },
      )
    }

    console.log(`[Forge] Asset ${id} banished — "${asset.prompt.slice(0, 40)}..."`)

    return NextResponse.json({
      success: true,
      message: `Asset "${id}" has been banished from The Forge`,
    })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge] DELETE /api/conjure/[id] error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓ॐ▓▓▓▓【A̸S̸S̸E̸T̸】▓▓▓▓ॐ▓▓▓▓【R̸O̸U̸T̸E̸】▓▓▓▓
