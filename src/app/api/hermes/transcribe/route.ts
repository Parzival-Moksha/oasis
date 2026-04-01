import { spawn } from 'child_process'
import { extname } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { buildHermesRemoteExec } from '@/lib/hermes-remote'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.aac'])

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

function canUseHermesTranscription(request: NextRequest): boolean {
  if (process.env.OASIS_ALLOW_REMOTE_HERMES_PROXY === 'true') return true

  const host = request.headers.get('host') || ''
  const hostName = host.split(':')[0]?.toLowerCase() || ''
  if (!isLoopbackHost(hostName)) return false

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && !isLoopbackHost(forwardedHost.split(':')[0] || '')) return false

  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  if (forwardedFor && forwardedFor !== '127.0.0.1' && forwardedFor !== '::1' && forwardedFor !== '[::1]') return false

  return true
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

function buildRemoteTranscriptionScript(extension: string) {
  return `
import json
import os
import sys
import tempfile

sys.path.insert(0, '/home/art3mis/.hermes/hermes-agent')

from tools.transcription_tools import transcribe_audio

suffix = ${JSON.stringify(extension)}
data = sys.stdin.buffer.read()

fd, path = tempfile.mkstemp(prefix='oasis-voice-', suffix=suffix)
os.close(fd)

try:
    with open(path, 'wb') as handle:
        handle.write(data)
    result = transcribe_audio(path)
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
finally:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
`
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesTranscription(request)) {
    return NextResponse.json({
      error: 'Hermes transcription is localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
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
    const exec = await buildHermesRemoteExec([
      '/home/art3mis/.hermes/hermes-agent/venv/bin/python',
      '-c',
      buildRemoteTranscriptionScript(extension),
    ])

    const audioBytes = Buffer.from(await audio.arrayBuffer())

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(exec.executable, exec.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
      })
      child.stderr.on('data', chunk => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', code => {
        resolve({ code, stdout, stderr })
      })

      child.stdin.write(audioBytes)
      child.stdin.end()
    })

    if (result.code !== 0) {
      return NextResponse.json({
        error: result.stderr.trim() || 'Hermes transcription failed.',
      }, { status: 502 })
    }

    const parsed = JSON.parse(result.stdout) as {
      success?: boolean
      transcript?: string
      error?: string
    }

    if (!parsed.success || !parsed.transcript) {
      return NextResponse.json({
        error: parsed.error || 'Hermes could not transcribe that recording.',
      }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      transcript: parsed.transcript,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to transcribe audio with Hermes.',
    }, { status: 500 })
  }
}
