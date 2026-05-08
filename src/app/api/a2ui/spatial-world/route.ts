import { NextRequest, NextResponse } from 'next/server'

import { materializeA2UIToSpatialWeb, parseA2UIEnvelopes } from '@/lib/a2ui-spatial-adapter'
import { saveWorld, createWorld } from '@/lib/forge/world-server'
import { getRequiredOasisUserId } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

async function readA2UIInput(request: NextRequest): Promise<{ body: Record<string, unknown>; source: unknown }> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('text/plain') || contentType.includes('application/x-ndjson')) {
    const text = await request.text()
    return { body: {}, source: text }
  }

  const body = await request.json().catch(() => ({}))
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const source = record.a2ui ?? record.messages ?? record.envelopes ?? record.jsonl ?? body
  return { body: record, source }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { body, source } = await readA2UIInput(request)
    const envelopes = parseA2UIEnvelopes(source)
    if (envelopes.length === 0) {
      return NextResponse.json({ ok: false, error: 'No A2UI messages found.' }, { status: 400 })
    }

    const result = materializeA2UIToSpatialWeb(envelopes, {
      surfaceId: sanitizeString(body.surfaceId),
      defaultAccentColor: sanitizeString(body.accentColor, '#38bdf8'),
      submitEndpoint: sanitizeString(body.submitEndpoint),
    })

    if (result.spatialWebObjects.length === 0 && result.catalogPlacements.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'A2UI parsed, but no supported spatial components were produced.',
        warnings: result.warnings,
        unsupportedComponents: result.unsupportedComponents,
      }, { status: 422 })
    }

    const meta = await createWorld(
      sanitizeString(body.name, `A2UI ${result.surfaceId}`),
      sanitizeString(body.icon, 'UI'),
      userId,
    )

    await saveWorld(meta.id, userId, {
      terrain: null,
      groundPresetId: 'none',
      groundTiles: {},
      terrainHeights: [],
      craftedScenes: [],
      conjuredAssetIds: [],
      catalogPlacements: result.catalogPlacements,
      portalGates: [],
      spatialWebObjects: result.spatialWebObjects,
      transforms: {},
      behaviors: result.behaviors,
      skyBackgroundId: 'night007',
      agentWindows: [],
      agentAvatars: [],
    })

    const origin = new URL(request.url).origin
    const worldUrl = `${origin}/w/${encodeURIComponent(meta.id)}`

    return NextResponse.json({
      ok: true,
      worldId: meta.id,
      worldUrl,
      surfaceId: result.surfaceId,
      componentCount: result.components.length,
      spatialObjectCount: result.spatialWebObjects.length,
      catalogPlacementCount: result.catalogPlacements.length,
      unsupportedComponents: result.unsupportedComponents,
      warnings: result.warnings,
    }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[A2UI] spatial-world error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
