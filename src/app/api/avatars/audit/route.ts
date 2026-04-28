import { NextResponse } from 'next/server'

import { getAvatarAuditSummary } from '@/lib/vrm-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const summary = await getAvatarAuditSummary()
    return NextResponse.json(summary)
  } catch (error) {
    console.error('[AvatarAudit] Failed to build avatar audit summary:', error)
    return NextResponse.json({ error: 'Failed to audit avatars' }, { status: 500 })
  }
}
