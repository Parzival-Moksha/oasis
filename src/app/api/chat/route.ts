// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — World Chat API
// GET  /api/chat?world_id=xxx — fetch recent messages
// POST /api/chat — send a message
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getServerSupabase } from '@/lib/supabase'

const MAX_MESSAGES = 200
const MAX_CONTENT_LENGTH = 10000

export async function GET(request: Request) {
  try {
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const worldId = searchParams.get('world_id')
    if (!worldId) {
      return NextResponse.json({ error: 'world_id required' }, { status: 400 })
    }

    const { data, error } = await getServerSupabase()
      .from('world_messages')
      .select('id, user_id, user_name, user_avatar, content, created_at')
      .eq('world_id', worldId)
      .order('created_at', { ascending: false })
      .limit(MAX_MESSAGES)

    if (error) {
      console.error('[Chat] GET error:', error.message)
      return NextResponse.json({ messages: [] })
    }

    // Reverse so oldest first (we queried newest-first for LIMIT)
    return NextResponse.json({ messages: (data || []).reverse() })
  } catch (err) {
    console.error('[Chat] GET error:', err)
    return NextResponse.json({ messages: [] })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { world_id, content } = body

    if (!world_id || !content) {
      return NextResponse.json({ error: 'world_id and content required' }, { status: 400 })
    }

    const trimmed = String(content).trim().slice(0, MAX_CONTENT_LENGTH)
    if (!trimmed) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 })
    }

    // Get user's display info
    const { data: profile } = await getServerSupabase()
      .from('profiles')
      .select('display_name, name, avatar_url')
      .eq('id', _uid)
      .single()

    const userName = profile?.display_name || profile?.name || 'Anonymous'
    const userAvatar = profile?.avatar_url || null

    const { data, error } = await getServerSupabase()
      .from('world_messages')
      .insert({
        world_id,
        user_id: _uid,
        user_name: userName,
        user_avatar: userAvatar,
        content: trimmed,
      })
      .select('id, user_id, user_name, user_avatar, content, created_at')
      .single()

    if (error) {
      console.error('[Chat] POST error:', error.message)
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    return NextResponse.json({ message: data })
  } catch (err) {
    console.error('[Chat] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
