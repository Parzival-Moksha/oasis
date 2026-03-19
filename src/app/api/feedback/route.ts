// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Anorak 0.0.1: Feedback Portal API
// GET   /api/feedback — list public feedback (bug reports + feature requests)
// POST  /api/feedback — submit feedback (+10 XP)
// PATCH /api/feedback — dev-only: update status (open/shipped/wontfix)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { getLocalUserId } from '@/lib/local-auth'
import { getServerSupabase } from '@/lib/supabase'

const MAX_TITLE_LENGTH = 500
const MAX_BODY_LENGTH = 50000
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ''

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // 'bug' | 'feature' | null (all)
    const status = searchParams.get('status') // 'open' | 'shipped' | null (all)

    let query = getServerSupabase()
      .from('feedback')
      .select('id, user_id, user_name, user_avatar, type, title, body, status, upvotes, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (type) query = query.eq('type', type)
    if (status) query = query.eq('status', status)

    const { data, error } = await query

    if (error) {
      console.error('[Anorak] GET error:', error.message)
      return NextResponse.json({ items: [] })
    }

    return NextResponse.json({ items: data || [] })
  } catch (err) {
    console.error('[Anorak] GET error:', err)
    return NextResponse.json({ items: [] })
  }
}

export async function POST(request: Request) {
  try {
    const _uid = await getLocalUserId()

    const body = await request.json()
    const { type, title, body: feedbackBody } = body

    if (!type || !['bug', 'feature'].includes(type)) {
      return NextResponse.json({ error: 'type must be "bug" or "feature"' }, { status: 400 })
    }
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title required' }, { status: 400 })
    }

    const trimmedTitle = String(title).trim().slice(0, MAX_TITLE_LENGTH)
    const trimmedBody = feedbackBody ? String(feedbackBody).trim().slice(0, MAX_BODY_LENGTH) : null

    // Get user display info
    const { data: profile } = await getServerSupabase()
      .from('profiles')
      .select('display_name, name, avatar_url')
      .eq('id', _uid)
      .single()

    const userName = profile?.display_name || profile?.name || 'Anonymous'
    const userAvatar = profile?.avatar_url || null

    const { data, error } = await getServerSupabase()
      .from('feedback')
      .insert({
        user_id: _uid,
        user_name: userName,
        user_avatar: userAvatar,
        type,
        title: trimmedTitle,
        body: trimmedBody,
        status: 'open',
        upvotes: 0,
      })
      .select('id, type, title, body, status, upvotes, created_at')
      .single()

    if (error) {
      console.error('[Anorak] POST error:', error.message)
      return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (err) {
    console.error('[Anorak] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, status } = body

    if (!id || !status || !['open', 'shipped', 'wontfix'].includes(status)) {
      return NextResponse.json({ error: 'id + status (open/shipped/wontfix) required' }, { status: 400 })
    }

    const { error } = await getServerSupabase()
      .from('feedback')
      .update({ status })
      .eq('id', id)

    if (error) {
      console.error('[Anorak] PATCH error:', error.message)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Anorak] PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
