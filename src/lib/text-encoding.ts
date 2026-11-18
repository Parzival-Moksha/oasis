// ░▒▓ TEXT ENCODING — text that lost its emoji on the way in ▓▒░
// A world icon (or name) sent from a Windows shell often arrives as "??": the shell's code page (cp1252) has no
// emoji, so each one becomes "?" before the request is even made (The Council's 🔥, 2026-11-18). The server can't
// get the emoji back, but it can refuse to store the damage: an icon made only of "?" (or U+FFFD, the replacement
// character) is never meant, so it falls back to a real emoji, and the caller is told why.

/** Only question marks / replacement characters (and spaces): an emoji that was lost in transit. */
export function looksLikeLostEmoji(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim()
  return t.length > 0 && /^[?�\s]+$/.test(t)
}

/** A world icon fit to store: the given one, or the fallback when it is missing or arrived as "??". */
export function cleanWorldIcon(icon: string | null | undefined, fallback = '🌍'): string {
  const t = String(icon ?? '').trim()
  return !t || looksLikeLostEmoji(t) ? fallback : t
}

export const LOST_EMOJI_HINT = 'The icon arrived as "?" (its emoji was lost on the way, usually a Windows shell sending non-UTF-8 text). Send the JSON as UTF-8, e.g. curl --data-binary @file.json, or write the emoji as a code-point escape.'
