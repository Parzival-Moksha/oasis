// GET /api/keys/status: which generation features have their key on this machine (src/lib/feature-keys.ts).
// Says only yes or no per feature, never a key's value. Loopback only.
import { NextRequest, NextResponse } from 'next/server'

import { featureKeyStates } from '@/lib/feature-keys'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  return NextResponse.json({ features: featureKeyStates(process.env) }, { headers: { 'cache-control': 'no-store' } })
}
