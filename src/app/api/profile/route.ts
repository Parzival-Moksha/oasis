// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Profile API
// GET  /api/profile — returns credits, xp, level, aura, identity
// PATCH /api/profile — update display_name, bio
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getServerSupabase } from '@/lib/supabase'
import { FREE_CREDITS } from '@/lib/conjure/types'
import { getLevelTitle, levelProgress, xpToNextLevel, levelFromXp } from '@/lib/xp'

const PROFILE_DEFAULTS = {
  credits: FREE_CREDITS, xp: 0, level: 1, aura: 0,
  wallet_address: null, levelTitle: 'Apprentice', levelBadge: '░',
  levelProgress: 0, xpToNext: 100, needsOnboarding: true,
  displayName: 'Wanderer', bio: null, avatar_url: null, avatar_3d_url: null,
}

export async function GET() {
  try {
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await getServerSupabase()
      .from('profiles')
      .select('credits, xp, level, aura, wallet_address, last_login_date, display_name, bio, avatar_url, avatar_3d_url, name')
      .eq('id', _uid)
      .single()

    if (error || !data) {
      return NextResponse.json(PROFILE_DEFAULTS)
    }

    const xp = data.xp || 0
    const level = levelFromXp(xp)
    const title = getLevelTitle(level)

    // Fix stale level in DB if needed
    if (level !== (data.level || 1)) {
      getServerSupabase()
        .from('profiles')
        .update({ level })
        .eq('id', _uid)
        .then(() => {})
    }

    return NextResponse.json({
      credits: data.credits,
      xp,
      level,
      aura: data.aura || 0,
      wallet_address: data.wallet_address,
      levelTitle: title.title,
      levelBadge: title.badge,
      levelProgress: levelProgress(xp),
      xpToNext: xpToNextLevel(level),
      needsOnboarding: !data.display_name,
      displayName: data.display_name || data.name || 'Wanderer',
      bio: data.bio || null,
      avatar_url: data.avatar_url,
      avatar_3d_url: data.avatar_3d_url || null,
      lastLoginDate: data.last_login_date || null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Profile] GET error:', msg)
    return NextResponse.json(PROFILE_DEFAULTS)
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.display_name !== undefined) {
      const name = String(body.display_name).trim().slice(0, 30)
      if (name.length < 2) {
        return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 })
      }
      updates.display_name = name
    }

    if (body.bio !== undefined) {
      updates.bio = String(body.bio).trim().slice(0, 200) || null
    }

    if (body.avatar_3d_url !== undefined) {
      // Only allow clearing via PATCH — saving handled by POST /api/profile/avatar3d
      if (body.avatar_3d_url === null || body.avatar_3d_url === '') {
        updates.avatar_3d_url = null
      }
    }

    const sb = getServerSupabase()
    const { error } = await sb
      .from('profiles')
      .update(updates)
      .eq('id', _uid)

    if (error) {
      console.error('[Profile] PATCH error:', error.message)
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    // ░▒▓ Sync display name to world cards — update cached creator_name on ALL user's worlds ▓▒░
    // Without this, explore page + view mode show stale Google OAuth name instead of chosen display name.
    if (updates.display_name) {
      await sb
        .from('worlds')
        .update({ creator_name: updates.display_name as string })
        .eq('user_id', _uid)
        .then(({ error: worldErr }) => {
          if (worldErr) console.error('[Profile] Failed to sync creator_name to worlds:', worldErr.message)
          else console.log(`[Profile] Synced creator_name "${updates.display_name}" to all worlds`)
        })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Profile] PATCH error:', msg)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
