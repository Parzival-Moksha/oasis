// ░▒▓ SPOKEN WORDS — when each word of a spoken line is said, for the player under a reply ▓▒░
// ElevenLabs answers with the time of every character (with-timestamps). The player shows the whole line and
// lights the word being said; this turns the character times into word times. Pure, so it can be tested.

import type { ElevenLabsAlignment } from '../lip-sync-lab'

export interface SpokenToken {
  text: string
  /** A word (lit while it is said), or the space between words. */
  word: boolean
  /** In the clip's own seconds (whatever the playback speed). */
  start: number
  end: number
}

/**
 * The line in tokens (words and the spaces between), each word with when it starts and ends in the clip.
 * When the alignment's characters are the line's own characters, their times are used as they are; otherwise
 * (no alignment, or text the voice service changed) the clip's length is shared out by position in the line.
 */
export function spokenTokens(text: string, alignment: ElevenLabsAlignment | null | undefined, duration?: number | null): SpokenToken[] {
  const parts = text.match(/\S+|\s+/g) || []
  const chars = alignment?.characters || []
  const starts = alignment?.character_start_times_seconds || []
  const ends = alignment?.character_end_times_seconds || []
  const exact = chars.length === text.length && chars.length === starts.length && chars.length === ends.length && chars.join('') === text
  const total = duration && duration > 0 ? duration : ends.length ? ends[ends.length - 1] : 0
  const out: SpokenToken[] = []
  let at = 0
  for (const part of parts) {
    const from = at
    const to = at + part.length
    at = to
    let start: number
    let end: number
    if (exact) {
      start = starts[from]
      end = ends[to - 1]
    } else {
      start = text.length ? (from / text.length) * total : 0
      end = text.length ? (to / text.length) * total : 0
    }
    out.push({ text: part, word: /\S/.test(part), start, end })
  }
  return out
}

/** The index of the word being said at `time` (the last one that has started), or -1 before the first. */
export function spokenWordAt(tokens: readonly SpokenToken[], time: number): number {
  let found = -1
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token.word) continue
    if (token.start > time) break
    found = i
  }
  return found
}

/** 0:07, 1:12. */
export function formatSpokenClock(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '-:--'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Speeds the player offers (the same setting as the agent's settings menu, 0.5x to 3x). */
export const PLAYER_SPEEDS = [0.75, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5] as const

/** The next speed up the list from `speed` (wraps to the slowest after the fastest). */
export function nextPlayerSpeed(speed: number): number {
  for (const option of PLAYER_SPEEDS) if (option > speed + 0.001) return option
  return PLAYER_SPEEDS[0]
}
