// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/upload-from-url — Server-side fetch (or base64 decode) → media library
// ─═̷─═̷─📥─═̷─═̷─ Used by upload_to_library MCP tool ─═̷─═̷─📥─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, extname } from 'path'

const MAX_BYTES = 250 * 1024 * 1024 // 250MB
const PUBLIC_DIR = join(process.cwd(), 'public', 'images')

const KIND_PREFIX: Record<string, string> = {
  image: 'img',
  video: 'vid',
  audio: 'aud',
}

const KIND_DEFAULT_EXT: Record<string, string> = {
  image: '.png',
  video: '.mp4',
  audio: '.mp3',
}

const VALID_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv',
  '.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aac', '.m4a',
])

function inferExtension(rawUrl: string, contentType: string, kind: string): string {
  try {
    const path = new URL(rawUrl).pathname
    const ext = extname(path).toLowerCase()
    if (ext && VALID_EXTS.has(ext)) return ext
  } catch { /* ignore parse errors */ }
  if (contentType) {
    const lower = contentType.toLowerCase()
    if (lower.includes('png')) return '.png'
    if (lower.includes('jpeg')) return '.jpg'
    if (lower.includes('webp')) return '.webp'
    if (lower.includes('gif')) return '.gif'
    if (lower.includes('mp4')) return '.mp4'
    if (lower.includes('webm')) return '.webm'
    if (lower.includes('quicktime')) return '.mov'
    if (lower.includes('mpeg')) return kind === 'video' ? '.mp4' : '.mp3'
    if (lower.includes('wav')) return '.wav'
    if (lower.includes('ogg')) return '.ogg'
  }
  return KIND_DEFAULT_EXT[kind] || ''
}

function decodeBase64(data: string): Buffer | null {
  const stripped = data.replace(/^data:[^;,]*(;base64)?,/, '').trim()
  if (!stripped) return null
  // Buffer.from(base64) silently drops invalid chars instead of throwing.
  // Validate the alphabet strictly so we don't write garbage to disk.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) return null
  if (stripped.length % 4 !== 0) return null
  try {
    return Buffer.from(stripped, 'base64')
  } catch {
    return null
  }
}

// SSRF guard — block loopback, link-local, private, and reserved ranges.
function isBlockedHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase()
  if (lowered === 'localhost' || lowered === 'localhost.localdomain') return true
  if (lowered === '0.0.0.0' || lowered === '::' || lowered === '::1') return true
  if (lowered === 'metadata.google.internal') return true
  // IPv4 dotted quads
  const m = lowered.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = m.slice(1).map(Number)
    if (a === 10) return true                              // 10.0.0.0/8 private
    if (a === 127) return true                             // loopback
    if (a === 169 && b === 254) return true                // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true       // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true                // 192.168.0.0/16 private
    if (a === 0) return true                               // 0.0.0.0/8
    if (a >= 224) return true                              // multicast + reserved
  }
  // IPv6 literals — block fc00::/7 (unique local) and fe80::/10 (link-local)
  if (lowered.startsWith('[fc') || lowered.startsWith('[fd')) return true
  if (lowered.startsWith('[fe8') || lowered.startsWith('[fe9') || lowered.startsWith('[fea') || lowered.startsWith('[feb')) return true
  return false
}

async function safeFetch(rawUrl: string, maxHops = 4): Promise<Response> {
  let currentUrl = rawUrl
  for (let hop = 0; hop <= maxHops; hop += 1) {
    let parsed: URL
    try {
      parsed = new URL(currentUrl)
    } catch {
      throw new Error('Invalid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Disallowed scheme: ${parsed.protocol}`)
    }
    if (isBlockedHost(parsed.hostname)) {
      throw new Error(`Disallowed host: ${parsed.hostname}`)
    }
    const response = await fetch(currentUrl, { redirect: 'manual' })
    // Manual redirect handling — validate every hop.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return response
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    return response
  }
  throw new Error('Too many redirects')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    const data = typeof body?.data === 'string' ? body.data.trim() : ''
    const kind = typeof body?.kind === 'string' ? body.kind.trim().toLowerCase() : ''
    const customName = typeof body?.name === 'string' ? body.name.trim() : ''

    if (!url && !data) {
      return NextResponse.json({ error: 'Provide url or data (base64).' }, { status: 400 })
    }
    if (!KIND_PREFIX[kind]) {
      return NextResponse.json({ error: 'kind must be image, video, or audio.' }, { status: 400 })
    }

    let buffer: Buffer
    let contentType = ''

    if (data) {
      const decoded = decodeBase64(data)
      if (!decoded) {
        return NextResponse.json({ error: 'Invalid base64 data.' }, { status: 400 })
      }
      buffer = decoded
    } else {
      let response: Response
      try {
        response = await safeFetch(url)
      } catch (err) {
        return NextResponse.json({ error: `Fetch failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
      }
      if (!response.ok) {
        return NextResponse.json({ error: `Fetch failed: HTTP ${response.status}` }, { status: 502 })
      }
      contentType = response.headers.get('content-type') || ''
      const ab = await response.arrayBuffer()
      buffer = Buffer.from(ab)
    }

    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: 'Asset is empty.' }, { status: 400 })
    }
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: `Asset too large (${buffer.byteLength} bytes, max ${MAX_BYTES}).` }, { status: 413 })
    }

    const ext = inferExtension(url, contentType, kind)
    if (!ext) {
      return NextResponse.json({ error: 'Could not infer file extension.' }, { status: 400 })
    }

    if (!existsSync(PUBLIC_DIR)) await mkdir(PUBLIC_DIR, { recursive: true })

    const safeBaseName = customName
      ? customName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
      : ''
    const id = `${KIND_PREFIX[kind]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const filename = safeBaseName ? `${id}-${safeBaseName}${ext}` : `${id}${ext}`
    const filePath = join(PUBLIC_DIR, filename)
    await writeFile(filePath, buffer)

    return NextResponse.json({
      url: `/images/${filename}`,
      name: filename,
      type: kind,
      size: buffer.byteLength,
    })
  } catch (err) {
    console.error('[Media:UploadFromUrl] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
