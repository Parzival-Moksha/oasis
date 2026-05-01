import { NextResponse } from 'next/server'

import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/admin-auth'
import { getOasisMode } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: getOasisMode() === 'hosted',
    path: '/',
    maxAge: 0,
  })
  return response
}
