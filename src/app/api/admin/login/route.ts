import { NextRequest, NextResponse } from 'next/server'

import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_S,
  getAdminUserId,
  isAdminAuthConfigured,
  signAdminSession,
  verifyAdminLoginToken,
} from '@/lib/admin-auth'
import { getOasisMode, getOasisProfile } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json({ ok: false, error: 'admin auth is not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!verifyAdminLoginToken(token)) {
    return NextResponse.json({ ok: false, error: 'invalid admin token' }, { status: 401 })
  }

  const cookieValue = signAdminSession(getAdminUserId())
  const response = NextResponse.json({
    ok: true,
    role: 'hosted-admin',
    capabilities: {
      mode: getOasisMode(),
      profile: getOasisProfile(),
      role: 'hosted-admin',
      admin: true,
      adminConfigured: true,
      canSeeSettings: true,
      canUseAdminPanels: true,
      canUseAgentPanels: true,
      canUseLocalPanels: true,
      canUseFullWizard: true,
    },
  })
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: getOasisMode() === 'hosted',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_S,
  })
  return response
}
