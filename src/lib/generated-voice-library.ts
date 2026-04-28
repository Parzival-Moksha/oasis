import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'

import type { ElevenLabsAlignment } from '@/lib/lip-sync-lab'

const VOICE_DIR = 'generated-voices'
const PUBLIC_DIR = join(process.cwd(), 'public', VOICE_DIR)
const DATA_DIR = join(process.cwd(), 'data')
const MANIFEST_PATH = join(DATA_DIR, 'generated-voice-library.json')
const MAX_GENERATED_VOICES = 100

export interface StoredGeneratedVoiceClip {
  id: string
  label: string
  url: string
  sourceType: 'generated'
  text: string
  voiceId: string
  createdAt: number
  alignment: ElevenLabsAlignment | null
  normalizedAlignment: ElevenLabsAlignment | null
}

async function ensureStorage(): Promise<void> {
  if (!existsSync(PUBLIC_DIR)) {
    await mkdir(PUBLIC_DIR, { recursive: true })
  }
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true })
  }
}

async function readManifest(): Promise<StoredGeneratedVoiceClip[]> {
  await ensureStorage()

  try {
    if (!existsSync(MANIFEST_PATH)) return []
    const raw = await readFile(MANIFEST_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item): item is StoredGeneratedVoiceClip => {
        return Boolean(
          item
          && typeof item === 'object'
          && typeof (item as StoredGeneratedVoiceClip).id === 'string'
          && typeof (item as StoredGeneratedVoiceClip).url === 'string',
        )
      })
      .map(item => ({
        id: item.id,
        label: typeof item.label === 'string' && item.label.trim() ? item.label : 'Generated voice',
        url: item.url,
        sourceType: 'generated' as const,
        text: typeof item.text === 'string' ? item.text : '',
        voiceId: typeof item.voiceId === 'string' ? item.voiceId : '',
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
        alignment: item.alignment || null,
        normalizedAlignment: item.normalizedAlignment || null,
      }))
      .sort((left, right) => right.createdAt - left.createdAt)
  } catch {
    return []
  }
}

async function writeManifest(clips: StoredGeneratedVoiceClip[]): Promise<void> {
  await ensureStorage()
  await writeFile(MANIFEST_PATH, JSON.stringify(clips, null, 2), 'utf8')
}

function filePathForUrl(url: string): string | null {
  if (!url.startsWith(`/${VOICE_DIR}/`)) return null
  return join(PUBLIC_DIR, url.slice(`/${VOICE_DIR}/`.length))
}

export async function listGeneratedVoiceClips(): Promise<StoredGeneratedVoiceClip[]> {
  const clips = await readManifest()
  const existing = clips.filter(clip => {
    const filePath = filePathForUrl(clip.url)
    return Boolean(filePath && existsSync(filePath))
  })

  if (existing.length !== clips.length) {
    await writeManifest(existing)
  }

  return existing
}

export async function getGeneratedVoiceClipByUrl(url: string): Promise<StoredGeneratedVoiceClip | null> {
  if (typeof url !== 'string' || !url.trim()) return null
  const normalizedUrl = url.trim()
  const clips = await listGeneratedVoiceClips()
  return clips.find(clip => clip.url === normalizedUrl) || null
}

export async function saveGeneratedVoiceClip(clip: StoredGeneratedVoiceClip): Promise<StoredGeneratedVoiceClip[]> {
  const existing = await listGeneratedVoiceClips()
  const next = [clip, ...existing.filter(entry => entry.id !== clip.id)]
    .sort((left, right) => right.createdAt - left.createdAt)

  const kept = next.slice(0, MAX_GENERATED_VOICES)
  const removed = next.slice(MAX_GENERATED_VOICES)

  for (const stale of removed) {
    const stalePath = filePathForUrl(stale.url)
    if (stalePath) {
      await unlink(stalePath).catch(() => {})
    }
  }

  await writeManifest(kept)
  return kept
}

export async function deleteGeneratedVoiceClip(id: string): Promise<StoredGeneratedVoiceClip[]> {
  const existing = await listGeneratedVoiceClips()
  const target = existing.find(clip => clip.id === id)
  if (target) {
    const filePath = filePathForUrl(target.url)
    if (filePath) {
      await rm(filePath, { force: true }).catch(() => {})
    }
  }

  const kept = existing.filter(clip => clip.id !== id)
  await writeManifest(kept)
  return kept
}

export async function cleanupGeneratedVoiceDirectory(): Promise<void> {
  await ensureStorage()

  try {
    const files = await readdir(PUBLIC_DIR)
    const audioFiles = files.filter(file => /\.(mp3|wav|ogg)$/i.test(file)).sort()
    if (audioFiles.length <= MAX_GENERATED_VOICES) return

    for (const oldFile of audioFiles.slice(0, audioFiles.length - MAX_GENERATED_VOICES)) {
      await unlink(join(PUBLIC_DIR, oldFile)).catch(() => {})
    }
  } catch {
    // Best-effort cleanup only.
  }
}
