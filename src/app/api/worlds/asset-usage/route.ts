// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ASSET USAGE — Count placements across ALL worlds
// ─═̷─═̷─ॐ─═̷─═̷─ Because "placed 1 time" was a lie ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET /api/worlds/asset-usage?url=...&currentWorldId=...&type=media|conjured
//
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { getOasisUserId } from '@/lib/session'
import { countAssetUsageAcrossWorlds } from '@/lib/forge/world-server'

export async function GET(request: Request) {
  try {
    const userId = await getOasisUserId(request)
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const currentWorldId = searchParams.get('currentWorldId') || ''
    const type = (searchParams.get('type') || 'media') as 'media' | 'conjured'

    if (!url) {
      return NextResponse.json({ error: 'Missing "url" param' }, { status: 400 })
    }

    const usage = await countAssetUsageAcrossWorlds(userId, url, currentWorldId, type)
    return NextResponse.json(usage)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[AssetUsage] GET error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
