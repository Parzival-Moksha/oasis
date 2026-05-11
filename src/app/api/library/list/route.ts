// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/library/list — Unified asset catalog for the viewer
// ─═̷─═̷─📚─═̷─═̷─ Wraps listAssets() with HTTP + viewer-cookie context ─═̷─═̷─📚─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { listAssets } from '@/lib/forge/library/library-service'
import { getLocalUserId } from '@/lib/local-auth'
import type { AssetKind, AssetScope } from '@/lib/forge/library/types'

export const dynamic = 'force-dynamic'

const VALID_KINDS: AssetKind[] = ['glb', 'gltf', 'vrm', 'sound', 'ground', 'sky', 'conjured', 'crafted']
const VALID_SCOPES: AssetScope[] = ['core', 'shared', 'user']

export async function GET(req: Request) {
  const url = new URL(req.url)
  const query = url.searchParams.get('query') || undefined
  const kindParam = url.searchParams.get('kind')
  const kind = kindParam && (VALID_KINDS as string[]).includes(kindParam) ? (kindParam as AssetKind) : undefined
  const scopeParam = url.searchParams.get('scope')
  const scope = scopeParam && (VALID_SCOPES as string[]).includes(scopeParam) ? (scopeParam as AssetScope) : undefined
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '2000', 10), 5000)
  const viewerUserId = await getLocalUserId()
  const assets = await listAssets({ viewerUserId, query, kind, scope, limit })
  return NextResponse.json({ assets, viewerUserId, count: assets.length })
}
