import { extname } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { getLocalSttStatus, transcribeLocally, warmLocalStt } from '@/lib/voice/local-stt'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.aac'])

// ─═̷─ Provider routing. Local dev defaults to faster-whisper (`local`).
// Hosted Ashburn has no faster-whisper binary, so calls there go to groq's
// Whisper endpoint via `?provider=groq`. Same FormData shape, just a
// different transcribe backend. ─═̷─
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = 'whisper-large-v3-turbo'

async function transcribeViaGroq(
  audio: Blob,
  audioName: string,
  language: string,
): Promise<{ ok: true; transcript: string; provider: 'groq-whisper' } | { ok: false; error: string; status: number }> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'GROQ_API_KEY not configured on this server.', status: 500 }
  }

  const form = new FormData()
  form.append('file', audio, audioName)
  form.append('model', GROQ_MODEL)
  if (language && language !== 'auto') form.append('language', language)
  form.append('response_format', 'json')

  let response: Response
  try {
    response = await fetch(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Groq fetch failed.', status: 502 }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { ok: false, error: `Groq Whisper HTTP ${response.status}: ${detail.slice(0, 200)}`, status: 502 }
  }

  const payload = await response.json().catch(() => null) as { text?: unknown } | null
  const transcript = typeof payload?.text === 'string' ? payload.text.trim() : ''
  if (!transcript) {
    return { ok: false, error: 'Groq returned no transcript text.', status: 422 }
  }
  return { ok: true, transcript, provider: 'groq-whisper' }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
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

  const languageField = form?.get('language')
  const language = typeof languageField === 'string' ? languageField : 'auto'

  // ─═̷─ Provider selection. `?provider=groq` routes to Groq's Whisper
  // endpoint (used by hosted Ashburn where faster-whisper isn't installed).
  // Anything else (or unset) uses the local faster-whisper binary. ─═̷─
  const requestedProvider = request.nextUrl.searchParams.get('provider')?.toLowerCase() || 'local'

  if (requestedProvider === 'groq') {
    const result = await transcribeViaGroq(audio, audio.name || `recording${extension}`, language)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({
      ok: true,
      transcript: result.transcript,
      provider: result.provider,
      language: language === 'auto' ? null : language,
      duration: null,
    })
  }

  try {
    const audioBytes = Buffer.from(await audio.arrayBuffer())
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
