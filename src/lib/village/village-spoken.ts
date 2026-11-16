// ░▒▓ VILLAGE SPOKEN — the short version of a reply that the agent's avatar says out loud ▓▒░
// A voiced agent ends each reply with one line `<spoken>…</spoken>` (the engine asks it to: agent.js
// VOICE_NOTE). The thread hides the tag and shows a play button; the avatar speaks the text with an
// ElevenLabs voice (/api/village/speak). Pure, so it can be tested.

/** What goes to text-to-speech at most (it costs per character). */
export const SPOKEN_MAX_CHARS = 400

const OPEN = '<spoken>'
const BLOCK = /<spoken>([\s\S]*?)<\/spoken>/gi

export interface SpokenSplit {
  /** The reply without any spoken tag: what the thread shows. */
  text: string
  /** What to say out loud (the last tag's words, cleaned and capped), or null. */
  spoken: string | null
}

/** Words to be heard: no markdown marks, one line, at most `max` characters, cut at a sentence or word end. */
export function cleanSpoken(raw: string, max = SPOKEN_MAX_CHARS): string {
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|~]/g, '')
    .replace(/<[^>]{0,40}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (sentence >= max * 0.5) return cut.slice(0, sentence + 1)
  const word = cut.lastIndexOf(' ')
  return (word >= max * 0.5 ? cut.slice(0, word) : cut).replace(/[\s,;:]+$/, '')
}

/** Does this text carry a spoken tag at all? (Cheap check before splitting.) */
export function hasSpoken(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.toLowerCase().includes(OPEN)
}

/**
 * Take the spoken tags out of a reply. The last complete tag is what gets said. A tag that never
 * closes (a clipped message) runs to the end of the text.
 */
export function splitSpoken(text: string | null | undefined): SpokenSplit {
  if (typeof text !== 'string' || !text) return { text: text || '', spoken: null }
  if (!hasSpoken(text)) return { text, spoken: null }
  let spoken: string | null = null
  let rest = text.replace(BLOCK, (_match, inner: string) => {
    if (inner.trim()) spoken = inner
    return ''
  })
  const open = rest.toLowerCase().lastIndexOf(OPEN)
  if (open !== -1) {
    const tail = rest.slice(open + OPEN.length)
    if (tail.trim()) spoken = tail
    rest = rest.slice(0, open)
  }
  const cleaned = spoken === null ? '' : cleanSpoken(spoken)
  return { text: rest.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd(), spoken: cleaned || null }
}

/**
 * The text still streaming in: hide a spoken tag as it arrives, including one that has only half
 * arrived ("<spo" at the very end), so the tag never flashes in the thread.
 */
export function hideSpokenLive(text: string | null | undefined): string {
  if (typeof text !== 'string' || !text) return text || ''
  let shown = hasSpoken(text) ? splitSpoken(text).text : text
  // A prefix of "<spoken>" at the very end.
  for (let length = Math.min(OPEN.length - 1, shown.length); length > 0; length -= 1) {
    if (shown.slice(-length).toLowerCase() === OPEN.slice(0, length)) {
      shown = shown.slice(0, -length)
      break
    }
  }
  return shown
}

/** Minimal view of a thread entry (AgentLogEntry without importing the store). */
export interface SpokenLogEntry {
  type: string
  text?: string
  parentToolUseId?: string | null
  history?: boolean
}

/**
 * What the agent says out loud for the turn that just ended: the spoken line of its last own text since
 * the owner's last message (subagent text and replayed history never speak). null: nothing to say.
 */
export function spokenForLastTurn(log: readonly SpokenLogEntry[]): string | null {
  let turnSeen = false
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const entry = log[i]
    if (entry.type === 'turn') {
      // The newest turn marker is the one that just ended; an older one closes the search.
      if (turnSeen) return null
      turnSeen = true
      if (entry.history) return null
      continue
    }
    if (entry.type === 'user') return null
    if (entry.type !== 'text' || entry.parentToolUseId || entry.history) continue
    return splitSpoken(entry.text).spoken
  }
  return null
}

/**
 * The spoken line as soon as it is complete in the text still streaming in (its closing tag has arrived):
 * the clip can be made while the turn winds down. null until then.
 */
export function spokenInStream(liveText: string | null | undefined): string | null {
  if (typeof liveText !== 'string' || !/<\/spoken>/i.test(liveText)) return null
  return splitSpoken(liveText).spoken
}

// ─── how fast it talks ──────────────────────────────────────────────────────

/**
 * The owner's speed setting, 1 = the voice as ElevenLabs reads it by default. Two things make the speed:
 * ElevenLabs' own `speed` voice setting (0.7 to 1.2, the model talks faster or slower, natural) and, for
 * what that cannot reach, the player's rate with the pitch kept. ElevenLabs' setting is not one to one:
 * measured on eleven_multilingual_v2 (2026-11-16), speed 1.2 made a 12.3 s clip 10.9 s long, 1.13x, so its
 * effect is taken as 65% of what it says.
 */
export const SPEECH_SPEED = { min: 0.8, max: 1.6, step: 0.1, default: 1.2, modelMin: 0.7, modelMax: 1.2, modelGain: 0.65 } as const

export function clampSpeechSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(n)) return SPEECH_SPEED.default
  return Math.round(Math.min(SPEECH_SPEED.max, Math.max(SPEECH_SPEED.min, n)) * 20) / 20
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

/** The player's rate that brings a clip made at `modelSpeed` to the speed the owner set. */
export function playbackRateFor(speed: number, modelSpeed: number): number {
  const rate = clampSpeechSpeed(speed) / modelSpeedEffect(modelSpeed)
  return Math.round(Math.min(2, Math.max(0.5, rate)) * 1000) / 1000
}

/** For a speed setting: what to ask ElevenLabs for, and the player's rate for the rest. */
export function speechSpeedPlan(speed: unknown): { speed: number; modelSpeed: number; playbackRate: number } {
  const target = clampSpeechSpeed(speed)
  const modelSpeed = clampModelSpeed(1 + (target - 1) / SPEECH_SPEED.modelGain)
  return { speed: target, modelSpeed, playbackRate: playbackRateFor(target, modelSpeed) }
}

// ─── voices ─────────────────────────────────────────────────────────────────

/** The voice an agent speaks with: Anorak is the wizard (the repo's Merlin voice), everyone else Adam. */
export function villageVoiceFor(name: string | null | undefined): 'merlin' | 'adam' {
  return /anorak/i.test(name || '') ? 'merlin' : 'adam'
}
