// ░▒▓ BYTE RANGE — the Range header of a request for a file served from memory (voice clips) ▓▒░
/** `bytes=a-b`, `bytes=a-` or `bytes=-n` (one range only). null: no range asked (or one we answer in full). */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, from, to] = match
  if (!from && !to) return null
  let start: number
  let end: number
  if (!from) {
    const suffix = Number(to)
    if (!suffix) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(from)
    end = to ? Math.min(Number(to), size - 1) : size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) return 'invalid'
  return { start, end }
}
