import 'server-only'

import { existsSync } from 'fs'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve, extname, sep } from 'path'
import { spawn } from 'child_process'

import ffmpegPath from 'ffmpeg-static'

import type { CanonicalMouthShape, MouthCue, MouthTimeline } from '@/lib/lip-sync-lab'

const RHUBARB_VERSION = '1.14.0'
const RHUBARB_PLATFORM = process.platform === 'win32'
  ? 'Windows'
  : process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'linux'
      ? 'Linux'
      : null
const RHUBARB_ARCHIVE_NAME = RHUBARB_PLATFORM ? `Rhubarb-Lip-Sync-${RHUBARB_VERSION}-${RHUBARB_PLATFORM}.zip` : ''
const RHUBARB_ARCHIVE_URL = RHUBARB_ARCHIVE_NAME
  ? `https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v${RHUBARB_VERSION}/${RHUBARB_ARCHIVE_NAME}`
  : ''
const CACHE_DIR = join(process.cwd(), '.cache', 'lip-sync-lab')
const RHUBARB_DIR = join(CACHE_DIR, `rhubarb-${RHUBARB_VERSION}`)
const RHUBARB_ARCHIVE_PATH = join(RHUBARB_DIR, RHUBARB_ARCHIVE_NAME || `Rhubarb-Lip-Sync-${RHUBARB_VERSION}.zip`)
const RHUBARB_EXTRACT_DIR = join(RHUBARB_DIR, 'extract')
const RHUBARB_BINARY_NAME = process.platform === 'win32' ? 'rhubarb.exe' : 'rhubarb'
const RHUBARB_WORK_DIR = join(CACHE_DIR, 'rhubarb-work')
const FFMPEG_BINARY_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

interface CommandResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

interface RhubarbJsonResult {
  metadata?: {
    duration?: number
  }
  mouthCues?: Array<{
    start?: number
    end?: number
    value?: string
  }>
}

const RHUBARB_TO_CANONICAL: Record<string, CanonicalMouthShape> = {
  A: 'pp',
  B: 'ss',
  C: 'ee',
  D: 'aa',
  E: 'oh',
  F: 'ou',
  G: 'ff',
  H: 'nn',
  X: 'sil',
}

function cueStrength(shape: CanonicalMouthShape): number {
  switch (shape) {
    case 'sil':
      return 0.5
    case 'pp':
    case 'ff':
    case 'th':
    case 'dd':
    case 'kk':
    case 'ch':
    case 'ss':
    case 'nn':
    case 'rr':
      return 0.82
    default:
      return 0.92
  }
}

function runCommand(command: string, args: string[], timeoutMs = 120000): Promise<CommandResult> {
  return new Promise(resolveResult => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolveResult({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Timed out after ${timeoutMs}ms.`,
      })
    }, timeoutMs)

    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
      })
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => {
        stderr += chunk
      })
    }

    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
      })
    })

    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        ok: code === 0,
        code,
        stdout,
        stderr,
      })
    })
  })
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

async function downloadRhubarbArchive(): Promise<void> {
  if (!RHUBARB_ARCHIVE_URL) {
    throw new Error(`Rhubarb auto-install is not configured for ${process.platform}`)
  }

  const response = await fetch(RHUBARB_ARCHIVE_URL, {
    headers: {
      'User-Agent': 'Oasis-LipSync-Lab',
      'Accept': 'application/octet-stream',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download Rhubarb (${response.status})`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(RHUBARB_ARCHIVE_PATH, bytes)
}

async function expandArchive(): Promise<void> {
  await ensureDir(RHUBARB_EXTRACT_DIR)

  if (process.platform !== 'win32') {
    const python3 = await runCommand('python3', ['-m', 'zipfile', '-e', RHUBARB_ARCHIVE_PATH, RHUBARB_EXTRACT_DIR], 120000)
    if (python3.ok) return

    const python = await runCommand('python', ['-m', 'zipfile', '-e', RHUBARB_ARCHIVE_PATH, RHUBARB_EXTRACT_DIR], 120000)
    if (python.ok) return

    const unzip = await runCommand('unzip', ['-q', RHUBARB_ARCHIVE_PATH, '-d', RHUBARB_EXTRACT_DIR], 120000)
    if (unzip.ok) return

    throw new Error(`Failed to expand Rhubarb archive: ${python3.stderr || python.stderr || unzip.stderr || 'python3/python/unzip unavailable'}`)
  }

  const escapedArchive = RHUBARB_ARCHIVE_PATH.replace(/'/g, "''")
  const escapedExtract = RHUBARB_EXTRACT_DIR.replace(/'/g, "''")
  const result = await runCommand('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedExtract}' -Force`,
  ], 120000)

  if (!result.ok) {
    throw new Error(`Failed to expand Rhubarb archive: ${result.stderr || result.stdout}`)
  }
}

async function findFileRecursive(rootDir: string, filename: string): Promise<string | null> {
  if (!existsSync(rootDir)) return null

  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath
    }
    if (entry.isDirectory()) {
      const nested = await findFileRecursive(fullPath, filename)
      if (nested) return nested
    }
  }

  return null
}

export async function ensureRhubarbBinary(): Promise<string> {
  const explicit = process.env.RHUBARB_BIN?.trim()
  if (explicit) {
    if (!explicit.includes('/') && !explicit.includes('\\')) return explicit
    if (!existsSync(explicit)) {
      throw new Error(`RHUBARB_BIN points to a missing file: ${explicit}`)
    }
    return explicit
  }

  if (!RHUBARB_PLATFORM) {
    throw new Error(`Rhubarb auto-install is not configured for ${process.platform}`)
  }

  await ensureDir(RHUBARB_DIR)

  const existing = await findFileRecursive(RHUBARB_EXTRACT_DIR, RHUBARB_BINARY_NAME)
  if (existing) {
    if (process.platform !== 'win32') await chmod(existing, 0o755).catch(() => {})
    return existing
  }

  if (!existsSync(RHUBARB_ARCHIVE_PATH)) {
    await downloadRhubarbArchive()
  }

  await expandArchive()

  const extracted = await findFileRecursive(RHUBARB_EXTRACT_DIR, RHUBARB_BINARY_NAME)
  if (!extracted) {
    throw new Error(`Rhubarb archive expanded, but ${RHUBARB_BINARY_NAME} was not found`)
  }
  if (process.platform !== 'win32') await chmod(extracted, 0o755).catch(() => {})

  return extracted
}

async function transcodeToWav(inputPath: string, outputPath: string): Promise<void> {
  const resolvedFfmpegPath = await resolveFfmpegBinary()
  if (!resolvedFfmpegPath) {
    throw new Error('ffmpeg-static is unavailable')
  }

  const result = await runCommand(resolvedFfmpegPath, [
    '-y',
    '-i',
    inputPath,
    '-ac',
    '1',
    '-ar',
    '16000',
    outputPath,
  ], 120000)

  if (!result.ok) {
    throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`)
  }
}

async function resolveFfmpegBinary(): Promise<string | null> {
  const directImportPath = typeof ffmpegPath === 'string' ? ffmpegPath : ''
  const candidates = [
    directImportPath,
    join(process.cwd(), 'node_modules', 'ffmpeg-static', FFMPEG_BINARY_NAME),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return await findFileRecursive(join(process.cwd(), 'node_modules'), FFMPEG_BINARY_NAME)
}

function mapRhubarbCue(value: string): CanonicalMouthShape | null {
  const normalized = value.trim().toUpperCase()
  return RHUBARB_TO_CANONICAL[normalized] || null
}

function buildTimelineFromRhubarbJson(result: RhubarbJsonResult): MouthTimeline {
  const cues: MouthCue[] = []
  const mouthCues = Array.isArray(result.mouthCues) ? result.mouthCues : []
  let duration = typeof result.metadata?.duration === 'number' ? result.metadata.duration : 0

  for (const cue of mouthCues) {
    const shape = typeof cue.value === 'string' ? mapRhubarbCue(cue.value) : null
    const start = cue.start
    const end = cue.end
    if (!shape) continue
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue

    cues.push({
      shape,
      start,
      end,
      strength: cueStrength(shape),
      source: `rhubarb:${cue.value}`,
    })
    duration = Math.max(duration, end)
  }

  return {
    cues,
    duration,
  }
}

export async function analyzeAudioWithRhubarb(args: {
  audioPath: string
  dialogText?: string | null
  recognizer?: 'pocketSphinx' | 'phonetic'
}): Promise<MouthTimeline> {
  const { audioPath, dialogText, recognizer = 'pocketSphinx' } = args
  const rhubarbPath = await ensureRhubarbBinary()

  await ensureDir(RHUBARB_WORK_DIR)

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const workDir = join(RHUBARB_WORK_DIR, jobId)
  await ensureDir(workDir)

  const inputExt = extname(audioPath).toLowerCase()
  const wavPath = join(workDir, inputExt === '.wav' ? 'input.wav' : 'input-from-ffmpeg.wav')
  const outputPath = join(workDir, 'rhubarb.json')
  const dialogPath = join(workDir, 'dialog.txt')

  try {
    if (inputExt === '.wav') {
      const bytes = await readFile(audioPath)
      await writeFile(wavPath, bytes)
    } else {
      await transcodeToWav(audioPath, wavPath)
    }

    const rhubarbArgs = [
      '-f',
      'json',
      '--machineReadable',
      '--extendedShapes',
      'GHX',
      '--recognizer',
      recognizer,
      '-o',
      outputPath,
    ]

    if (dialogText?.trim()) {
      await writeFile(dialogPath, dialogText.trim(), 'utf8')
      rhubarbArgs.push('-d', dialogPath)
    }

    rhubarbArgs.push(wavPath)

    const result = await runCommand(rhubarbPath, rhubarbArgs, 120000)
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || 'Rhubarb analysis failed')
    }

    const raw = await readFile(outputPath, 'utf8')
    const parsed = JSON.parse(raw) as RhubarbJsonResult
    return buildTimelineFromRhubarbJson(parsed)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function resolvePublicClipPath(clipUrl: string): string | null {
  if (!clipUrl || !clipUrl.startsWith('/')) return null
  const publicRoot = resolve(process.cwd(), 'public')
  const candidate = resolve(publicRoot, clipUrl.slice(1))
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${sep}`)) return null
  return candidate
}
