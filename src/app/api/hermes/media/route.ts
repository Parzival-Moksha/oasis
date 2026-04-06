import { spawn } from 'child_process'
import { extname } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { buildHermesRemoteExec } from '@/lib/hermes-remote'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp4', '.webm', '.m4v',
])

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

function canUseHermesMedia(request: NextRequest): boolean {
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

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHermesMediaPath(rawPath: string): string {
  let next = sanitizeString(rawPath)
  if (!next) return ''

  const wrappedMatch = next.match(/^(?:Path|PosixPath)\((['"])(.+)\1\)$/)
  if (wrappedMatch?.[2]) {
    next = wrappedMatch[2].trim()
  }

  next = next.replace(/^['"`]+|['"`]+$/g, '').trim()

  if (/^file:\/\//i.test(next)) {
    try {
      const url = new URL(next)
      next = decodeURIComponent(url.pathname)
    } catch {
      next = next.replace(/^file:\/\//i, '')
    }
  }

  const explicitPathMatch = next.match(/((?:https?:\/\/|file:\/\/|~\/|\/(?:home|tmp)\/)[^\s"'`]+?\.(?:mp3|wav|ogg|oga|opus|m4a|png|jpg|jpeg|gif|webp|mp4|webm|m4v)(?:\?[^\s"'`]+)?)/i)
  if (explicitPathMatch?.[1]) {
    return explicitPathMatch[1].trim()
  }

  return next.replace(/[)\],.;:!?]+$/g, '').trim()
}

function hasAllowedMediaExtension(remotePath: string): boolean {
  return ALLOWED_MEDIA_EXTENSIONS.has(extname(remotePath).toLowerCase())
}

function isAllowedHermesMediaPath(remotePath: string): boolean {
  if (!remotePath) return false
  if (!hasAllowedMediaExtension(remotePath)) return false
  if (remotePath.includes('\0')) return false
  if (remotePath.split('/').some(segment => segment === '..')) return false
  return /^(?:~\/|\/home\/[^/]+\/|\/tmp\/)/.test(remotePath)
}

function inferContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  switch (extension) {
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
    case '.oga':
    case '.opus':
      return 'audio/ogg'
    case '.m4a':
      return 'audio/mp4'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.m4v':
      return 'video/mp4'
    default:
      return 'application/octet-stream'
  }
}

function buildReadRemoteFileScript(remotePath: string) {
  return `
from pathlib import Path
import sys

path = Path(${JSON.stringify(remotePath)}).expanduser().resolve(strict=False)
home = Path.home().resolve()
tmp_root = Path('/tmp').resolve()

if not (path == home or home in path.parents or path == tmp_root or tmp_root in path.parents):
  sys.stderr.write('Remote media path is outside allowed Hermes roots.\\n')
  sys.exit(4)

if not path.is_file():
  sys.stderr.write('Remote media file not found.\\n')
  sys.exit(2)

if path.stat().st_size > 50 * 1024 * 1024:
  sys.stderr.write('Remote media file is too large.\\n')
  sys.exit(3)

sys.stdout.buffer.write(path.read_bytes())
`
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesMedia(request)) {
    return NextResponse.json({
      error: 'Hermes media proxy is localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
  }

  const remotePath = normalizeHermesMediaPath(request.nextUrl.searchParams.get('path') || '')
  if (!isAllowedHermesMediaPath(remotePath)) {
    return NextResponse.json({ error: 'Unsupported Hermes media path.' }, { status: 400 })
  }

  try {
    const exec = await buildHermesRemoteExec(['python3', '-'])

    const result = await new Promise<{ code: number | null; stdout: Buffer; stderr: string }>((resolve, reject) => {
      const child = spawn(exec.executable, exec.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      const chunks: Buffer[] = []
      let stderr = ''

      child.stdout.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => {
        stderr += chunk
      })
      child.once('error', reject)
      child.stdin.on('error', reject)
      child.once('close', code => {
        resolve({ code, stdout: Buffer.concat(chunks), stderr })
      })

      child.stdin.end(buildReadRemoteFileScript(remotePath))
    })

    if (result.code !== 0) {
      return NextResponse.json({
        error: result.stderr.trim() || 'Unable to read remote Hermes media file.',
      }, { status: 502 })
    }

    return new NextResponse(new Uint8Array(result.stdout), {
      headers: {
        'Content-Type': inferContentType(remotePath),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to stream Hermes media.',
    }, { status: 500 })
  }
}
