import { NextRequest, NextResponse } from 'next/server'

import { readAdminKpiDashboard } from '@/lib/oasis-analytics'
import { getOasisCapabilities } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const capabilities = getOasisCapabilities(request)
    if (capabilities.mode === 'hosted' && !capabilities.admin) {
      return NextResponse.json({ error: 'admin session required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || 'daily'
    const dashboard = await readAdminKpiDashboard({ range })
    return NextResponse.json(dashboard)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[admin/kpis] GET failed:', message)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
