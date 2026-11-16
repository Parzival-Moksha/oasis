// ░▒▓ VILLAGE VOICES — the ten voices an agent can speak with, and each agent's own voice and speed ▓▒░
// Pure: the list, who gets which voice, and the per-agent settings as they are stored (this browser,
// keyed by session like an agent's skin). The page side is village-companion.ts, the ElevenLabs call
// village-speech-server.ts.

export interface VillageVoice {
  /** What is stored and sent to /api/village/speak. */
  key: string
  /** ElevenLabs voice id. */
  id: string
  name: string
  /** A few words for the dropdown. */
  sound: string
}

/**
 * Ten voices, picked to differ: deep and bright, men and women, narrators and characters. Nine are
 * ElevenLabs' own premade voices (every account has them); "merlin" is the wise-sage voice Anorak has
 * spoken with from the start (a library voice in the owner's account, also the repo's Merlin voice).
 */
export const VILLAGE_VOICES: readonly VillageVoice[] = [
  { key: 'merlin', id: '6sFKzaJr574YWVu4UuJF', name: 'Cornelius', sound: 'old wise sage, deep, British' },
  { key: 'brian', id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', sound: 'deep, resonant, calm man' },
  { key: 'george', id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', sound: 'warm storyteller, British man' },
  { key: 'daniel', id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', sound: 'steady newsreader, British man' },
  { key: 'charlie', id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', sound: 'energetic young man, Australian' },
  { key: 'callum', id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', sound: 'husky trickster, a character' },
  { key: 'sarah', id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', sound: 'mature, reassuring woman' },
  { key: 'jessica', id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', sound: 'playful, bright young woman' },
  { key: 'lily', id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', sound: 'velvety actress, British woman' },
  { key: 'laura', id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', sound: 'quirky, sassy young woman' },
]

/** Anorak's voice unless the owner picks another. */
export const ANORAK_VOICE = 'merlin'

export function villageVoice(key: string | null | undefined): VillageVoice | null {
  return VILLAGE_VOICES.find(voice => voice.key === key) || null
}

// ─── speed ──────────────────────────────────────────────────────────────────

/**
 * How fast an agent talks, 1 = the voice as ElevenLabs reads it by default. Two things make the speed:
 * ElevenLabs' own `speed` voice setting (0.7 to 1.2: the model talks faster or slower, natural) and, for
 * what that cannot reach, the player's rate with the pitch kept. ElevenLabs' setting is not one to one:
 * measured on eleven_multilingual_v2 (2026-11-16), speed 1.2 made a 12.3 s clip 10.9 s long, 1.13x, so its
 * effect is taken as 65% of what it says.
 */
export const SPEECH_SPEED = { min: 0.5, max: 3, step: 0.1, default: 1.3, modelMin: 0.7, modelMax: 1.2, modelGain: 0.65 } as const

/** A speed setting: inside the range, on the slider's 0.1 steps. */
export function clampSpeechSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(n)) return SPEECH_SPEED.default
  return Math.round(Math.min(SPEECH_SPEED.max, Math.max(SPEECH_SPEED.min, n)) * 10) / 10
}

/** ElevenLabs' `speed` as it may be sent: inside its range, in steps of 0.05 (few distinct clips per line). */
export function clampModelSpeed(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.round(Math.min(SPEECH_SPEED.modelMax, Math.max(SPEECH_SPEED.modelMin, n)) * 20) / 20
}

/** How much faster a clip made at `modelSpeed` really is than one made at 1. */
export function modelSpeedEffect(modelSpeed: number): number {
  return 1 + (modelSpeed - 1) * SPEECH_SPEED.modelGain
}

/** The player's rate that brings a clip made at `modelSpeed` to the speed set. */
export function playbackRateFor(speed: number, modelSpeed: number): number {
  const rate = clampSpeechSpeed(speed) / modelSpeedEffect(modelSpeed)
  return Math.round(Math.min(4, Math.max(0.25, rate)) * 1000) / 1000
}

/** For a speed setting: what to ask ElevenLabs for, and the player's rate for the rest. */
export function speechSpeedPlan(speed: unknown): { speed: number; modelSpeed: number; playbackRate: number } {
  const target = clampSpeechSpeed(speed)
  const modelSpeed = clampModelSpeed(1 + (target - 1) / SPEECH_SPEED.modelGain)
  return { speed: target, modelSpeed, playbackRate: playbackRateFor(target, modelSpeed) }
}

// ─── each agent's own settings ──────────────────────────────────────────────

export interface AgentVoicePrefs {
  /** A VILLAGE_VOICES key. */
  voice?: string
  /** The owner chose the voice (it was not dealt at random). */
  picked?: boolean
  speed?: number
}
/** By session key (villageAgentKey: the session id, or the agent id before it has one). */
export type VoicePrefs = Record<string, AgentVoicePrefs>

export function parseVoicePrefs(raw: string | null | undefined): VoicePrefs {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: VoicePrefs = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as AgentVoicePrefs
      const clean: AgentVoicePrefs = {}
      if (villageVoice(entry.voice)) {
        clean.voice = entry.voice
        if (entry.picked === true) clean.picked = true
      }
      if (typeof entry.speed === 'number' && Number.isFinite(entry.speed)) clean.speed = clampSpeechSpeed(entry.speed)
      if (clean.voice || clean.speed !== undefined) out[key] = clean
    }
    return out
  } catch {
    return {}
  }
}

/** The agent's speed: its own, else the default. */
export function speedOf(prefs: VoicePrefs, key: string): number {
  const speed = prefs[key]?.speed
  return typeof speed === 'number' ? clampSpeechSpeed(speed) : SPEECH_SPEED.default
}

/** The voice the agent has, if it has one already: its stored one, or Anorak's for an Anorak. null: none dealt yet. */
export function voiceOf(prefs: VoicePrefs, key: string, name: string | null | undefined): string | null {
  const stored = prefs[key]?.voice
  if (villageVoice(stored)) return stored as string
  return /anorak/i.test(name || '') ? ANORAK_VOICE : null
}

/**
 * Deal a voice to an agent that has none: a random one of the ten, preferring voices nobody has yet
 * (so a village of ten sounds like ten). `random` is Math.random in the app, fixed in tests.
 */
export function dealVoice(prefs: VoicePrefs, random: () => number = Math.random): string {
  const taken = new Map<string, number>()
  for (const entry of Object.values(prefs)) if (entry.voice) taken.set(entry.voice, (taken.get(entry.voice) || 0) + 1)
  // Anorak's voice counts as taken once even before he has spoken.
  taken.set(ANORAK_VOICE, Math.max(1, taken.get(ANORAK_VOICE) || 0))
  const fewest = Math.min(...VILLAGE_VOICES.map(voice => taken.get(voice.key) || 0))
  const free = VILLAGE_VOICES.filter(voice => (taken.get(voice.key) || 0) === fewest)
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))].key
}

/** The prefs with one agent's entry changed (an empty entry is dropped). */
export function withVoicePrefs(prefs: VoicePrefs, key: string, patch: AgentVoicePrefs): VoicePrefs {
  const entry: AgentVoicePrefs = { ...prefs[key], ...patch }
  if (entry.speed !== undefined) entry.speed = clampSpeechSpeed(entry.speed)
  if (entry.speed === SPEECH_SPEED.default) delete entry.speed
  if (!villageVoice(entry.voice)) {
    delete entry.voice
    delete entry.picked
  }
  const next = { ...prefs }
  if (entry.voice || entry.speed !== undefined) next[key] = entry
  else delete next[key]
  return next
}
