// ░▒▓ VILLAGE SPEECH (server) — a village agent's spoken line as an ElevenLabs clip, cached by its text ▓▒░
// Same call as the generate_voice tool (/api/media/voice: text-to-speech with character timings, which
// drive the lip sync), but kept in its own folder keyed by what is said: the same line never costs twice,
// and the clips don't push the owner's generated voices out of their 100-clip library.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { ElevenLabsAlignment } from '@/lib/lip-sync-lab'
import { SPOKEN_MAX_CHARS, cleanSpoken } from '@/lib/village/village-spoken'
import { VILLAGE_VOICES, clampModelSpeed, villageVoice } from '@/lib/village/village-voices'

/** Voices from before each agent had its own (same ids as /api/media/voice): clips asked for by these names still resolve. */
const OLDER_VOICES: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
}
const MAX_CLIPS = 300

export interface SpokenClip {
  id: string
  text: string
  voiceId: string
  alignment: ElevenLabsAlignment | null
  /** ElevenLabs' `speed` voice setting the clip was made with (1 = its default). */
  modelSpeed: number
  /** Served from the cache: no ElevenLabs call was made. */
  cached: boolean
}

type EnvLike = { [key: string]: string | undefined }

export function speechDir(env: EnvLike = process.env): string {
  // Under the generated-voices folder (git-ignored); its own subfolder, which the voice library's cleanup never reads.
  return env.OASIS_VILLAGE_SPEECH_DIR || path.join(process.cwd(), 'public', 'generated-voices', 'village-speech')
}

export function resolveSpeechVoice(voice: unknown, env: EnvLike = process.env): string {
  const key = typeof voice === 'string' ? voice.trim() : ''
  // One of the village's ten (village-voices.ts); the Merlin voice can be swapped in .env as before.
  if (key === 'merlin' && env.OASIS_MERLIN_ELEVENLABS_VOICE_ID) return env.OASIS_MERLIN_ELEVENLABS_VOICE_ID
  const known = villageVoice(key)
  if (known) return known.id
  if (OLDER_VOICES[key]) return OLDER_VOICES[key]
  if (/^[A-Za-z0-9]{20,32}$/.test(key)) return key
  return VILLAGE_VOICES[1].id
}

export function speechModel(env: EnvLike = process.env): string {
  return env.OASIS_VILLAGE_VOICE_MODEL || 'eleven_multilingual_v2'
}

/** The clip's name: what is said, by which voice and model, at which model speed (1 keeps the names clips had before speeds). */
export function speechClipId(text: string, voiceId: string, model: string, modelSpeed = 1): string {
  return createHash('sha1').update(`${model}\n${voiceId}\n${text}${modelSpeed === 1 ? '' : `\nspeed=${modelSpeed.toFixed(2)}`}`).digest('hex').slice(0, 24)
}

export function isSpeechClipId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{24}$/.test(id)
}

function isAlignment(value: unknown): value is ElevenLabsAlignment {
  const candidate = value as ElevenLabsAlignment | null | undefined
  return Boolean(candidate && Array.isArray(candidate.characters) && Array.isArray(candidate.character_start_times_seconds) && Array.isArray(candidate.character_end_times_seconds))
}

async function readCached(dir: string, id: string): Promise<SpokenClip | null> {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8')) as Partial<SpokenClip>
    await fs.access(path.join(dir, `${id}.mp3`))
    return { id, text: String(meta.text || ''), voiceId: String(meta.voiceId || ''), alignment: isAlignment(meta.alignment) ? meta.alignment : null, modelSpeed: clampModelSpeed(meta.modelSpeed), cached: true }
  } catch {
    return null
  }
}

/** Keep the newest MAX_CLIPS clips. */
async function prune(dir: string): Promise<void> {
  try {
    const names = (await fs.readdir(dir)).filter(name => name.endsWith('.mp3'))
    if (names.length <= MAX_CLIPS) return
    const aged = await Promise.all(names.map(async name => ({ name, at: (await fs.stat(path.join(dir, name))).mtimeMs })))
    aged.sort((a, b) => a.at - b.at)
    for (const { name } of aged.slice(0, aged.length - MAX_CLIPS)) {
      await fs.rm(path.join(dir, name), { force: true })
      await fs.rm(path.join(dir, name.replace(/\.mp3$/, '.json')), { force: true })
    }
  } catch {
    // Best effort.
  }
}

const inflight = new Map<string, Promise<SpokenClip>>()

export class SpeechError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

/**
 * The clip for `text` in `voice`: from the cache, else one ElevenLabs call. The text is cleaned and
 * capped at SPOKEN_MAX_CHARS first, so a long or marked-up line can never cost more than that.
 * `speed`: ElevenLabs' own voice speed (0.7 to 1.2; the page plays the rest of a faster setting itself).
 */
export async function speak(rawText: unknown, voice: unknown, options: { env?: EnvLike; fetcher?: typeof fetch; speed?: unknown } = {}): Promise<SpokenClip> {
  const env = options.env || process.env
  const text = typeof rawText === 'string' ? cleanSpoken(rawText, SPOKEN_MAX_CHARS) : ''
  if (!text) throw new SpeechError('Nothing to say', 400)
  const voiceId = resolveSpeechVoice(voice, env)
  const model = speechModel(env)
  const modelSpeed = clampModelSpeed(options.speed)
  const id = speechClipId(text, voiceId, model, modelSpeed)
  const dir = speechDir(env)
  const cached = await readCached(dir, id)
  if (cached) return cached
  const running = inflight.get(id)
  if (running) return running

  const job = (async (): Promise<SpokenClip> => {
    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey) throw new SpeechError('ELEVENLABS_API_KEY not configured', 500)
    const response = await (options.fetcher || fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true, ...(modelSpeed === 1 ? {} : { speed: modelSpeed }) },
      }),
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      console.error('[Village:Speech] ElevenLabs error:', response.status, detail)
      throw new SpeechError(`Voice generation failed (${response.status})`, 502)
    }
    const payload = await response.json() as { audio_base64?: string; alignment?: unknown; normalized_alignment?: unknown }
    if (!payload.audio_base64) throw new SpeechError('Voice generation returned no audio', 502)
    const alignment = isAlignment(payload.normalized_alignment) ? payload.normalized_alignment : isAlignment(payload.alignment) ? payload.alignment : null
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${id}.mp3`), Buffer.from(payload.audio_base64, 'base64'))
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, text, voiceId, model, modelSpeed, createdAt: Date.now(), alignment }), 'utf8')
    void prune(dir)
    return { id, text, voiceId, alignment, modelSpeed, cached: false }
  })()
  inflight.set(id, job)
  try {
    return await job
  } finally {
    inflight.delete(id)
  }
}

export async function readSpeechAudio(id: string, env: EnvLike = process.env): Promise<Buffer | null> {
  if (!isSpeechClipId(id)) return null
  try {
    return await fs.readFile(path.join(speechDir(env), `${id}.mp3`))
  } catch {
    return null
  }
}
