// ░▒▓ ANORAK DIGEST — what a Telegram chat sees of an agent's turn: its words and how long it worked ▓▒░
// No tool lists ("read 4 files, ran 13 commands"): between the texts an agent writes, one line
// "🔮 conjured for 2 min 10 sec", and at the end "✓ done · conjured for 14 min 15 sec". Idle time
// between turns (waiting for you) is never counted. Pure: the bridge feeds engine events in and sends
// what comes out (scripts/telegram-bridge.ts).

export const CONJURE_NOTE_AFTER_MS = 20_000
export const TELEGRAM_MAX_CHARS = 4000

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return m ? `${h} h ${m} min` : `${h} h`
  if (m) return s ? `${m} min ${s} sec` : `${m} min`
  return `${s} sec`
}

/** Telegram takes 4096 characters a message: split on paragraph, then line, then hard. */
export function splitForTelegram(text: string, max = TELEGRAM_MAX_CHARS): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max)
    if (cut < max * 0.5) cut = max
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export type DigestEvent =
  | { kind: 'user.sent'; ts: number; uuid?: string }
  | { kind: 'text'; ts: number; text: string; parentToolUseId?: string | null }
  | { kind: 'turn.end'; ts: number; outcome?: string; reason?: string | null; isError?: boolean; durationMs?: number | null }
  | { kind: string; ts: number; [key: string]: unknown }

export class AnorakDigest {
  /** Forward every turn, not only the ones a Telegram message started. */
  followAll: boolean
  private turnStart: number | null = null
  private lastMark: number | null = null
  private ours = false
  private readonly sentUuids = new Set<string>()

  constructor(options: { followAll?: boolean } = {}) {
    this.followAll = Boolean(options.followAll)
  }

  /** A message this chat sent (the engine's send reply carries its uuid): its turn goes to Telegram. */
  claim(uuid: string | null | undefined): void {
    if (uuid) this.sentUuids.add(uuid)
    this.ours = true
  }

  get inTurn(): boolean {
    return this.turnStart !== null
  }

  /** One engine event in, zero or more Telegram messages out. */
  push(event: DigestEvent): string[] {
    switch (event.kind) {
      case 'user.sent': {
        const e = event as { ts: number; uuid?: string }
        if (e.uuid && this.sentUuids.has(e.uuid)) {
          this.sentUuids.delete(e.uuid)
          this.ours = true
        }
        if (this.turnStart === null) this.turnStart = e.ts
        if (this.lastMark === null) this.lastMark = e.ts
        return []
      }
      case 'text': {
        const e = event as { ts: number; text: string; parentToolUseId?: string | null }
        // A helper's (subagent's) words stay inside; only the agent's own text goes out.
        if (e.parentToolUseId || !e.text?.trim()) return []
        if (this.turnStart === null) this.turnStart = e.ts
        const gap = this.lastMark === null ? 0 : e.ts - this.lastMark
        this.lastMark = e.ts
        if (!this.forwarding) return []
        const note = gap >= CONJURE_NOTE_AFTER_MS ? `🔮 conjured for ${formatDuration(gap)}\n\n` : ''
        return splitForTelegram(note + e.text.trim())
      }
      case 'turn.end': {
        const e = event as { ts: number; outcome?: string; reason?: string | null; isError?: boolean; durationMs?: number | null }
        const started = this.turnStart
        const forwarding = this.forwarding
        this.turnStart = null
        this.lastMark = null
        this.ours = false
        if (!forwarding) return []
        const worked = started !== null ? e.ts - started : (typeof e.durationMs === 'number' ? e.durationMs : 0)
        if (e.isError || e.outcome === 'error') return [`⚠ stopped after ${formatDuration(worked)}${e.reason ? `: ${e.reason}` : ''}`]
        if (e.outcome === 'needs-decision') return [`✋ needs you in the Oasis (a permission or a question) · conjured for ${formatDuration(worked)}`]
        return [`✓ done · conjured for ${formatDuration(worked)}`]
      }
      default:
        return []
    }
  }

  private get forwarding(): boolean {
    return this.followAll || this.ours
  }
}
