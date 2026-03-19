// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/imagine — Text-to-Image via Gemini Flash (OpenRouter)
// ─═̷─═̷─🎨─═̷─═̷─ Prompt → Gemini → base64 PNG → disk → URL ─═̷─═̷─🎨─═̷─═̷─
//
// Full-res image saved to public/generated-images/{id}.{ext}
// Tile version (256×256 JPEG q70, ~8-15KB) for ground textures.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const IMAGINE_MODELS: Record<string, { id: string; label: string }> = {
  'gemini-flash': { id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini Flash' },
  'riverflow': { id: 'sourceful/riverflow-v2-fast', label: 'Riverflow v2' },
  'flux-klein': { id: 'black-forest-labs/flux.2-klein-4b', label: 'FLUX Klein' },
  'seedream': { id: 'bytedance-seed/seedream-4.5', label: 'Seedream 4.5' },
}
const DEFAULT_MODEL = 'gemini-flash'
const IMAGE_DIR = 'generated-images'

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/imagine — Generate an image from text
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, model: modelKey } = body
    const selectedModel = IMAGINE_MODELS[modelKey as string] || IMAGINE_MODELS[DEFAULT_MODEL]

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: 'Prompt too long (2000 char max)' }, { status: 400 })
    }

    // Local mode — no credits. Bring your own API keys.

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'LLM provider not configured' }, { status: 500 })
    }

    // ░▒▓ CALL OPENROUTER — selected image model ▓▒░
    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://04515.xyz',
        'X-Title': 'Oasis Imagine',
      },
      body: JSON.stringify({
        model: selectedModel.id,
        messages: [
          { role: 'user', content: `Generate an image: ${prompt.trim()}. Output ONLY the image, no text.` },
        ],
      }),
    })

    if (!llmResponse.ok) {
      const err = await llmResponse.text()
      console.error('[Imagine] OpenRouter error:', llmResponse.status, err.slice(0, 500))
      return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
    }

    const data = await llmResponse.json()
    // ░▒▓ DEBUG — dump full response shape to diagnose extraction failures ▓▒░
    console.log('[Imagine] Response keys:', Object.keys(data))
    console.log('[Imagine] Full response (truncated):', JSON.stringify(data).slice(0, 1500))
    const imageBase64 = extractImageFromResponse(data)
    if (!imageBase64) {
      console.error('[Imagine] No image extracted. Response shape:', JSON.stringify(data).slice(0, 2000))
      return NextResponse.json({ error: 'No image in model response' }, { status: 502 })
    }

    // ░▒▓ SAVE TO DISK ▓▒░
    const imageId = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const dir = join(process.cwd(), 'public', IMAGE_DIR)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // Handle both base64 data URIs and remote URLs
    let buffer: Buffer
    let mimeType: string
    if (imageBase64.startsWith('http://') || imageBase64.startsWith('https://')) {
      // Remote URL — download it
      console.log(`[Imagine] Downloading remote image: ${imageBase64.slice(0, 120)}...`)
      const imgRes = await fetch(imageBase64)
      if (!imgRes.ok) {
        console.error('[Imagine] Failed to download image:', imgRes.status)
        return NextResponse.json({ error: 'Failed to download generated image' }, { status: 502 })
      }
      buffer = Buffer.from(await imgRes.arrayBuffer())
      mimeType = imgRes.headers.get('content-type') || 'image/png'
    } else {
      const decoded = decodeBase64Image(imageBase64)
      buffer = decoded.buffer
      mimeType = decoded.mimeType
    }
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
    const filename = `${imageId}.${ext}`
    writeFileSync(join(dir, filename), buffer)
    console.log(`[Imagine] Saved full image: ${filename} (${(buffer.length / 1024).toFixed(1)}KB) model=${selectedModel.id}`)

    // ░▒▓ TILE VERSION — 256×256 JPEG for ground textures (~8-15KB) ▓▒░
    let tileFilename = filename // fallback: same as full
    try {
      const sharp = (await import('sharp')).default
      const tileBuffer = await sharp(buffer)
        .resize(256, 256, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer()
      tileFilename = `${imageId}_tile.jpg`
      writeFileSync(join(dir, tileFilename), tileBuffer)
      console.log(`[Imagine] Saved tile: ${tileFilename} (${(tileBuffer.length / 1024).toFixed(1)}KB)`)
    } catch (e) {
      console.warn('[Imagine] sharp unavailable, tile = full image:', (e as Error).message)
    }

    return NextResponse.json({
      id: imageId,
      url: `/${IMAGE_DIR}/${filename}`,
      tileUrl: `/${IMAGE_DIR}/${tileFilename}`,
      prompt: prompt.trim(),
      createdAt: new Date().toISOString(),
    }, { status: 201 })

  } catch (err) {
    console.error('[Imagine] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE EXTRACTION — Handle multiple response formats from multimodal models
// ═══════════════════════════════════════════════════════════════════════════════

function extractImageFromResponse(data: Record<string, unknown>): string | null {
  // ─═̷─ Strategy: try every known response format, return first hit ─═̷─

  // ═══ FORMAT A: OpenAI images/generations style — data[].url or data[].b64_json ═══
  const topData = data.data as Array<{ url?: string; b64_json?: string }> | undefined
  if (Array.isArray(topData)) {
    for (const item of topData) {
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
      if (item.url) return item.url
    }
  }

  // ═══ FORMAT B: Chat completions — choices[].message.content ═══
  const choices = data.choices as Array<{ message: { content: unknown } }> | undefined
  const message = choices?.[0]?.message
  if (message) {
    const content = message.content

    // B1: content is array with multimodal parts
    if (Array.isArray(content)) {
      for (const part of content) {
        // OpenAI/Gemini style: { type: "image_url", image_url: { url: "data:..." } }
        if (part?.type === 'image_url' && part.image_url?.url) {
          return part.image_url.url as string
        }
        // Anthropic style: { type: "image", source: { data: "...", media_type: "image/png" } }
        if (part?.type === 'image' && part.source?.data) {
          const mime = part.source.media_type || 'image/png'
          return `data:${mime};base64,${part.source.data}`
        }
        // Inline base64 in text part
        if (part?.type === 'text' && typeof part.text === 'string') {
          const match = part.text.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
          if (match) return match[0]
        }
        // Direct URL in content part
        if (typeof part === 'string') {
          const match = part.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
          if (match) return match[0]
        }
      }
    }

    // B2: content is string with inline data URI or URL
    if (typeof content === 'string') {
      const match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
      if (match) return match[0]
      // Some models return a raw URL to the generated image
      const urlMatch = content.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp|gif)/i)
      if (urlMatch) return urlMatch[0]
    }
  }

  // ═══ FORMAT C: Deep scan — recursively look for any base64 image or URL in the response ═══
  const jsonStr = JSON.stringify(data)
  // Look for data URIs
  const dataUriMatch = jsonStr.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/)
  if (dataUriMatch) return dataUriMatch[0]
  // Look for b64_json fields
  const b64Match = jsonStr.match(/"b64_json"\s*:\s*"([A-Za-z0-9+/=]{100,})"/)
  if (b64Match) return `data:image/png;base64,${b64Match[1]}`
  // Look for image URLs
  const imgUrlMatch = jsonStr.match(/"(https?:\/\/[^"]+\.(png|jpg|jpeg|webp))"/i)
  if (imgUrlMatch) return imgUrlMatch[1]

  return null
}

function decodeBase64Image(dataUri: string): { buffer: Buffer; mimeType: string } {
  // data:image/png;base64,iVBOR...
  const match = dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/)
  if (match) {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    }
  }
  // Raw base64 without data URI prefix
  return {
    mimeType: 'image/png',
    buffer: Buffer.from(dataUri, 'base64'),
  }
}

// ▓▓▓▓【I̸M̸A̸G̸I̸N̸E̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓
