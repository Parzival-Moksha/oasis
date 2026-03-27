// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/video — Text-to-Video via fal.ai LTX 2.3
// POST: submit job → returns requestId immediately (non-blocking)
// GET: poll status by requestId → returns status or video URL
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'

const FAL_API = 'https://queue.fal.run/fal-ai/ltx-video-13b'

// POST — submit video generation job (non-blocking)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, duration = 5 } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: 'Prompt too long (2000 char max)' }, { status: 400 })
    }

    const apiKey = process.env.FAL_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
    }

    const submitRes = await fetch(FAL_API, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.trim(),
        num_frames: Math.min(Math.max(duration, 2), 10) * 24,
        seed: Math.floor(Math.random() * 999999),
      }),
    })

    if (!submitRes.ok) {
      const err = await submitRes.text().catch(() => 'unknown')
      console.error('[Media:Video] fal.ai submit error:', submitRes.status, err.slice(0, 500))
      return NextResponse.json({ error: 'Video submission failed' }, { status: 502 })
    }

    const result = await submitRes.json()

    // Direct result (rare for video)
    const directUrl = result.video?.url || result.output?.url || null
    if (directUrl) {
      return NextResponse.json({ status: 'completed', url: directUrl })
    }

    // Queue result — return request_id for polling
    if (result.request_id) {
      return NextResponse.json({ status: 'queued', requestId: result.request_id })
    }

    return NextResponse.json({ error: 'No request_id or video in response' }, { status: 502 })
  } catch (err) {
    console.error('[Media:Video] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// GET — poll video generation status
export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get('requestId')
  if (!requestId) {
    return NextResponse.json({ error: 'requestId param required' }, { status: 400 })
  }

  const apiKey = process.env.FAL_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
  }

  try {
    const statusRes = await fetch(`${FAL_API}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${apiKey}` },
    })
    if (!statusRes.ok) {
      return NextResponse.json({ status: 'unknown', error: `Status check failed: ${statusRes.status}` })
    }

    const statusData = await statusRes.json().catch(() => null)
    if (!statusData) {
      return NextResponse.json({ status: 'unknown', error: 'Non-JSON status response' })
    }

    if (statusData.status === 'COMPLETED') {
      // Fetch the actual result
      const resultRes = await fetch(`${FAL_API}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${apiKey}` },
      })
      if (resultRes.ok) {
        const final = await resultRes.json().catch(() => null)
        const videoUrl = final?.video?.url || final?.output?.url || null
        if (videoUrl) {
          return NextResponse.json({ status: 'completed', url: videoUrl, requestId })
        }
      }
      return NextResponse.json({ status: 'completed', error: 'URL extraction failed' })
    }

    if (statusData.status === 'FAILED') {
      return NextResponse.json({ status: 'failed', error: 'Video generation failed on provider' })
    }

    return NextResponse.json({ status: 'processing', requestId })
  } catch (err) {
    return NextResponse.json({ status: 'unknown', error: `Poll error: ${err}` })
  }
}
