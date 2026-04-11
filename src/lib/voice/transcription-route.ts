import { extname } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { getLocalSttStatus, transcribeLocally, warmLocalStt } from '@/lib/voice/local-stt'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.aac'])

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function normalizeHostName(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  const withoutPort = trimmed.startsWith('[')
    ? trimmed.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1')
    : trimmed.split(':')[0] || ''
  return withoutPort
}

function isPrivateIpv4Host(hostname: string): boolean {
  const parts = hostname.split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false

  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIpv6Host(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  )
}

function isTrustedLocalNetworkHost(hostname: string): boolean {
  if (!hostname) return false
  if (isLoopbackHost(hostname)) return true
  if (isPrivateIpv4Host(hostname)) return true
  if (isPrivateIpv6Host(hostname)) return true
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.lan') || hostname.endsWith('.home.arpa') || hostname.endsWith('.ts.net')) {
    return true
  }
  return false
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return true

  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true

    const [hostName, hostPort = ''] = host.split(':')
    const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')
    const requestPort = hostPort || (originUrl.protocol === 'https:' ? '443' : '80')

    return isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostName) && originPort === requestPort
  } catch {
    return false
  }
}

function inferExtension(fileName: string, mimeType: string): string {
  const ext = extname(fileName || '').toLowerCase()
  if (ALLOWED_EXTENSIONS.has(ext)) return ext

  const byMime: Record<string, string> = {
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
  }

  return byMime[mimeType.toLowerCase()] || '.webm'
}

export async function handleVoiceTranscriptionGet(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }

  const shouldWarm = request.nextUrl.searchParams.get('warm') === '1'

  if (shouldWarm) {
    try {
      const status = await warmLocalStt()
      return NextResponse.json({
        ok: status.state === 'ready',
        ...status,
      })
    } catch (error) {
      const status = getLocalSttStatus()
      return NextResponse.json({
        ok: false,
        ...status,
        error: error instanceof Error ? error.message : 'Unable to warm the local voice model.',
      }, { status: 500 })
    }
  }

  const status = getLocalSttStatus()
  return NextResponse.json({
    ok: status.state === 'ready',
    ...status,
  })
}

export async function handleVoiceTranscriptionPost(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }

  const form = await request.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'Audio upload is required.' }, { status: 400 })
  }
  if (audio.size <= 0) {
    return NextResponse.json({ error: 'Audio upload is empty.' }, { status: 400 })
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio upload is too large.' }, { status: 400 })
  }

  const extension = inferExtension(audio.name || 'recording.webm', audio.type || '')
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: 'Unsupported audio format.' }, { status: 400 })
  }

  try {
    const audioBytes = Buffer.from(await audio.arrayBuffer())
    const languageField = form?.get('language')
    const language = typeof languageField === 'string' ? languageField : 'auto'
    const parsed = await transcribeLocally(audioBytes, extension, language)
    const transcript = parsed.transcript.trim()

    if (!transcript) {
      return NextResponse.json({
        error: 'I could not hear any clear speech in that recording.',
      }, { status: 422 })
    }

    return NextResponse.json({
      ok: true,
      transcript,
      provider: 'local-faster-whisper',
      language: parsed.language || null,
      duration: parsed.duration ?? null,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to transcribe audio locally.',
    }, { status: 500 })
  }
}
