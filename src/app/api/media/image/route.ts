// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/image — Proxy to /api/imagine with simplified response
// ─═̷─═̷─🎨─═̷─═̷─ Same OpenRouter backend, cleaner shape for MCP ─═̷─═̷─🎨─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, model } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    // Forward to the existing imagine endpoint
    const origin = request.nextUrl.origin
    const res = await fetch(`${origin}/api/imagine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: model || 'gemini-flash' }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Image generation failed' }))
      return NextResponse.json(err, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({
      url: data.url || data.imageUrl,
      model: data.model || model || 'gemini-flash',
    })
  } catch (err) {
    console.error('[Media:Image] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
