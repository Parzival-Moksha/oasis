// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/video — Text-to-Video + Image-to-Video via fal.ai LTX 2.3
// POST: submit job → returns requestId immediately (non-blocking)
// GET: poll status by requestId → returns status or local video URL
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const TEXT_TO_VIDEO = 'https://queue.fal.run/fal-ai/ltx-2.3/text-to-video'
const IMG_TO_VIDEO = 'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video'
const IMG_TO_VIDEO_FAST = 'https://queue.fal.run/fal-ai/ltx-2.3/image-to-video/fast'

const VIDEO_DIR = path.join(process.cwd(), 'public', 'generated-videos')
const MAX_FILES = 50

/** Snap duration to nearest valid LTX-2.3 value (even integers 6-20) */
function clampDuration(d: number): number {
  const valid = [6, 8, 10, 12, 14, 16, 18, 20]
  return valid.reduce((prev, curr) => Math.abs(curr - d) < Math.abs(prev - d) ? curr : prev)
}

function selectEndpoint(imageUrl?: string, fast?: boolean): string {
  if (imageUrl) return fast ? IMG_TO_VIDEO_FAST : IMG_TO_VIDEO
  return TEXT_TO_VIDEO
}

function cleanupOldVideos() {
  try {
    if (!fs.existsSync(VIDEO_DIR)) return
    const entries = fs.readdirSync(VIDEO_DIR)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({ name: f, time: fs.statSync(path.join(VIDEO_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    if (entries.length > MAX_FILES) {
      for (const e of entries.slice(MAX_FILES)) {
        fs.unlinkSync(path.join(VIDEO_DIR, e.name))
      }
    }
  } catch {}
}

// POST — submit video generation job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, duration = 6, image_url, fast, negative_prompt, resolution, aspect_ratio, num_inference_steps, guidance_scale } = body

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

    const endpoint = selectEndpoint(image_url, fast)
    const falBody: Record<string, unknown> = {
      prompt: prompt.trim(),
      duration: clampDuration(duration),
      seed: Math.floor(Math.random() * 999999),
    }
    if (negative_prompt) falBody.negative_prompt = negative_prompt
    if (resolution) falBody.resolution = resolution
    if (aspect_ratio) falBody.aspect_ratio = aspect_ratio
    if (num_inference_steps) falBody.num_inference_steps = num_inference_steps
    if (guidance_scale) falBody.guidance_scale = guidance_scale
    if (image_url) falBody.image_url = image_url

    const submitRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falBody),
    })

    if (!submitRes.ok) {
      const err = await submitRes.text().catch(() => 'unknown')
      console.error('[Media:Video] fal.ai submit error:', submitRes.status, err.slice(0, 500))
      if (submitRes.status === 429) {
        return NextResponse.json({ error: 'Rate limited — try again shortly', retryAfter: 30 }, { status: 429 })
      }
      return NextResponse.json({ error: 'Video submission failed' }, { status: 502 })
    }

    const result = await submitRes.json()

    // Direct result (rare for video)
    const directUrl = result.video?.url || result.output?.url || null
    if (directUrl) {
      return NextResponse.json({ status: 'completed', url: directUrl })
    }

    // Queue result — return request_id + endpoint for polling
    if (result.request_id) {
      return NextResponse.json({ status: 'queued', requestId: result.request_id, endpoint })
    }

    return NextResponse.json({ error: 'No request_id or video in response' }, { status: 502 })
  } catch (err) {
    console.error('[Media:Video] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// GET — poll video generation status + download to local
export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get('requestId')
  const endpoint = request.nextUrl.searchParams.get('endpoint') || TEXT_TO_VIDEO
  if (!requestId) {
    return NextResponse.json({ error: 'requestId param required' }, { status: 400 })
  }

  const apiKey = process.env.FAL_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
  }

  try {
    const statusRes = await fetch(`${endpoint}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${apiKey}` },
    })
    if (!statusRes.ok) {
      if (statusRes.status === 404) {
        return NextResponse.json({ status: 'unknown', error: 'Request expired or not found' })
      }
      return NextResponse.json({ status: 'unknown', error: `Status check failed: ${statusRes.status}` })
    }

    const statusData = await statusRes.json().catch(() => null)
    if (!statusData) {
      return NextResponse.json({ status: 'unknown', error: 'Non-JSON status response' })
    }

    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetch(`${endpoint}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${apiKey}` },
      })
      if (resultRes.ok) {
        const final = await resultRes.json().catch(() => null)
        const videoUrl = final?.video?.url || final?.output?.url || null
        if (videoUrl) {
          // Download to local
          try {
            fs.mkdirSync(VIDEO_DIR, { recursive: true })
            const filename = `video-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`
            const localPath = path.join(VIDEO_DIR, filename)
            const videoRes = await fetch(videoUrl)
            if (videoRes.ok) {
              const buffer = Buffer.from(await videoRes.arrayBuffer())
              fs.writeFileSync(localPath, buffer)
              cleanupOldVideos()
              return NextResponse.json({ status: 'completed', url: `/generated-videos/${filename}`, requestId })
            }
          } catch (dlErr) {
            console.error('[Media:Video] Download failed, using CDN URL:', dlErr)
          }
          // Fallback to CDN URL
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
