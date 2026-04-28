import { NextResponse } from 'next/server'

import { resolveCodexModelSettings } from '@/lib/codex-models'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await resolveCodexModelSettings())
}
