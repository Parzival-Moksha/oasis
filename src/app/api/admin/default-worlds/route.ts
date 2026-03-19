// Admin Default Worlds API — GET/PATCH the default world config
// Protected by ADMIN_USER_ID check (mirrors /api/admin/pricing)

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getServerSupabase } from '@/lib/supabase'
import { invalidateDefaultWorldsCache } from '@/lib/default-worlds'

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ''

async function isAdmin() {
  const session = await auth()
  return session?.user?.id === ADMIN_USER_ID && !!ADMIN_USER_ID
}

// GET — return current default worlds config
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data } = await getServerSupabase()
    .from('app_config')
    .select('value, updated_at')
    .eq('key', 'default_worlds')
    .single()

  return NextResponse.json({
    defaultWorlds: data?.value ?? { anon: null, new_user: null },
    updatedAt: data?.updated_at ?? null,
  })
}

// PATCH — update default worlds config
export async function PATCH(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Validate: only accept 'anon' and 'new_user', each string or null
  const updates: Record<string, string | null> = {}
  for (const key of ['anon', 'new_user'] as const) {
    if (key in body) {
      const val = body[key]
      if (val !== null && typeof val !== 'string') {
        return NextResponse.json({ error: `Invalid value for ${key}: must be a string or null` }, { status: 400 })
      }
      // Trim and normalize empty strings to null
      updates[key] = typeof val === 'string' && val.trim() ? val.trim() : null
    }
  }

  // Read current, merge, write
  const sb = getServerSupabase()
  const { data: existing } = await sb
    .from('app_config')
    .select('value')
    .eq('key', 'default_worlds')
    .single()

  const merged = { ...(existing?.value as Record<string, string | null> || { anon: null, new_user: null }), ...updates }

  const { error } = await sb
    .from('app_config')
    .upsert({
      key: 'default_worlds',
      value: merged,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    return NextResponse.json({ error: 'Failed to update default worlds' }, { status: 500 })
  }

  // Bust the server-side cache so the next page render picks up new values
  invalidateDefaultWorldsCache()

  return NextResponse.json({ defaultWorlds: merged })
}
