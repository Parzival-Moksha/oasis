import { NextRequest, NextResponse } from 'next/server'

import { isAdminAuthConfigured, readAdminSession } from '@/lib/admin-auth'
import { getOasisCapabilities } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const adminSession = readAdminSession(request)
  return NextResponse.json({
    ok: true,
    configured: isAdminAuthConfigured(),
    admin: Boolean(adminSession),
    subject: adminSession?.sub ?? null,
    capabilities: getOasisCapabilities(request),
  })
}
