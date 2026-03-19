// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Animation Presets Route
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════╗
//   ║  GET /api/conjure/animations                                  ║
//   ║                                                               ║
//   ║  Fetch the full catalog of 586 Meshy animation presets.       ║
//   ║  Cached server-side for 1 hour — these don't change often.    ║
//   ║                                                               ║
//   ║  Returns: { presets: MeshyAnimationPreset[] }                 ║
//   ║                                                               ║
//   ║  "586 dances, each a different way of being alive."           ║
//   ╚═══════════════════════════════════════════════════════════════╝
//
// ░▒▓█ ANIMATION PRESETS ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { MeshyClient } from '@/lib/conjure/meshy'

// ═══════════════════════════════════════════════════════════════════════════
// SERVER-SIDE CACHE — the dance catalog is cached for 1 hour
// Meshy's preset list is static enough to not warrant per-request fetching.
// ═══════════════════════════════════════════════════════════════════════════

let cachedPresets: unknown[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour

export async function GET() {
  try {
    const now = Date.now()
    if (cachedPresets && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return NextResponse.json({ presets: cachedPresets })
    }

    const client = new MeshyClient()
    const presets = await client.listAnimationPresets()

    cachedPresets = presets
    cacheTimestamp = now

    return NextResponse.json({ presets })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge] GET /api/conjure/animations error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ▓▓▓▓【A̸N̸I̸M̸A̸T̸I̸O̸N̸S̸】▓▓▓▓ॐ▓▓▓▓【P̸R̸E̸S̸E̸T̸S̸】▓▓▓▓
