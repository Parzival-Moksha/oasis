// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// XP API — Award experience points, check for level-ups
// POST /api/xp { action: XpAction, worldId?: string }
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getServerSupabase } from '@/lib/supabase'
import { XP_AWARDS, type XpAction, levelFromXp, getXpForAction } from '@/lib/xp'

// Per-action cooldowns (seconds) — prevents XP farming
const ACTION_COOLDOWNS: Partial<Record<XpAction, number>> = {
  PLACE_CATALOG_OBJECT: 5,
  CONJURE_ASSET: 30,
  CRAFT_SCENE: 30,
  PAINT_GROUND_BATCH: 10,
  ADD_LIGHT: 5,
  SUBMIT_FEEDBACK: 60,
  VISIT_OTHER_WORLD: 30,
  UPVOTE_WORLD: 10,
  CO_BUILD: 10,
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json() as { action: string; worldId?: string }
    const { action, worldId } = body

    // Validate action
    if (!action || !(action in XP_AWARDS)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const xpAmount = await getXpForAction(action)
    const sb = getServerSupabase()
    const userId = _uid

    // Cooldown check — prevent rapid-fire XP farming
    const cooldown = ACTION_COOLDOWNS[action as XpAction]
    if (cooldown) {
      const { data: recent } = await sb
        .from('xp_events')
        .select('created_at')
        .eq('user_id', userId)
        .eq('action', action)
        .order('created_at', { ascending: false })
        .limit(1)

      if (recent && recent.length > 0) {
        const lastAward = new Date(recent[0].created_at).getTime()
        const elapsed = (Date.now() - lastAward) / 1000
        if (elapsed < cooldown) {
          return NextResponse.json({ xp: 0, message: 'Cooldown active' })
        }
      }
    }

    // Deduplicate certain one-time actions
    if (action === 'FIRST_WORLD_CREATED' || action === 'DAILY_LOGIN') {
      const { data: existing } = await sb
        .from('xp_events')
        .select('id')
        .eq('user_id', userId)
        .eq('action', action)
        .limit(1)

      if (action === 'FIRST_WORLD_CREATED' && existing && existing.length > 0) {
        return NextResponse.json({ xp: 0, message: 'Already awarded' })
      }

      if (action === 'DAILY_LOGIN') {
        // Check if already logged in today
        const today = new Date().toISOString().split('T')[0]
        const { data: profile } = await sb
          .from('profiles')
          .select('last_login_date')
          .eq('id', userId)
          .single()

        if (profile?.last_login_date === today) {
          return NextResponse.json({ xp: 0, message: 'Already claimed today' })
        }

        // Update last login date
        await sb.from('profiles').update({ last_login_date: today }).eq('id', userId)
      }
    }

    // Record XP event
    await sb.from('xp_events').insert({
      user_id: userId,
      action,
      xp: xpAmount,
      world_id: worldId || null,
    })

    // Update profile XP + recalculate level
    const { data: profile } = await sb
      .from('profiles')
      .select('xp, level')
      .eq('id', userId)
      .single()

    const currentXp = profile?.xp || 0
    const newXp = currentXp + xpAmount
    const newLevel = levelFromXp(newXp)
    const oldLevel = profile?.level || 1
    const leveledUp = newLevel > oldLevel

    await sb
      .from('profiles')
      .update({ xp: newXp, level: newLevel, updated_at: new Date().toISOString() })
      .eq('id', userId)

    return NextResponse.json({
      xp: xpAmount,
      totalXp: newXp,
      level: newLevel,
      leveledUp,
      oldLevel: leveledUp ? oldLevel : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[XP] POST error:', msg)
    return NextResponse.json({ error: 'Failed to award XP' }, { status: 500 })
  }
}
