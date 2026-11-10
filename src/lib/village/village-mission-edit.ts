// ░▒▓ MINDCRAFT EDITS — changing a mission file: its header, its log, the guessed replies ▓▒░
// Pure text in, text out; the API route does the reading and writing.
//
// The log is the mission's thread, newest last, under `## Log`:
//     - 2026-11-10 14:02 · Morrow: what happened, in a sentence or a few.
//       - guess (owner): what Morrow expects the owner to answer.
//     - 2026-11-10 14:20 · owner: what the owner really said.
//       - guess match: 42%
// Older entries (`- 2026-11-10. Text.`) have no time and no author: they still read as entries.
// A "guess" is the carbon answer: an agent's estimate of the owner's reply, kept next to the real
// one so both can be compared later.

export interface MissionLogEntry {
  /** `2026-11-10`, or '' when the line has no date. */
  date: string
  /** `14:02`, or ''. */
  time: string
  /** Who wrote it; '' for old entries. */
  who: string
  text: string
  /** What the writer expects somebody to answer. */
  guess: { who: string; text: string } | null
  /** On an answer to a guess: how close the guess was, 0..1. */
  guessMatch: number | null
}

const LOG_HEADING = /^##\s+Log\s*$/i
const ENTRY = /^- (\d{4}-\d{2}-\d{2})(?: (\d{1,2}:\d{2}))?(?:\s*·\s*([^:]{1,60}):|\.)?\s*(.*)$/
const GUESS = /^\s+- guess \(([^)]{1,60})\):\s*(.*)$/i
const MATCH = /^\s+- guess match:\s*(\d{1,3})%\s*$/i

/** The file in two parts: everything before `## Log`, and the log's own lines (null: no log yet). */
export function splitMissionLog(markdown: string): { before: string; log: string[] | null; after: string } {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => LOG_HEADING.test(line))
  if (start < 0) return { before: markdown, log: null, after: '' }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return { before: lines.slice(0, start).join('\n'), log: lines.slice(start + 1, end), after: lines.slice(end).join('\n') }
}

export function parseMissionLog(markdown: string): MissionLogEntry[] {
  const { log } = splitMissionLog(markdown)
  const entries: MissionLogEntry[] = []
  for (const line of log || []) {
    if (!line.trim()) continue
    const current = entries[entries.length - 1]
    const top = line.startsWith('- ')
    if (top) {
      const match = ENTRY.exec(line)
      entries.push(match
        ? { date: match[1], time: match[2] || '', who: (match[3] || '').trim(), text: match[4], guess: null, guessMatch: null }
        : { date: '', time: '', who: '', text: line.slice(2), guess: null, guessMatch: null })
      continue
    }
    if (!current) continue
    const guess = GUESS.exec(line)
    if (guess) {
      current.guess = { who: guess[1].trim(), text: guess[2] }
      continue
    }
    const matched = MATCH.exec(line)
    if (matched) {
      current.guessMatch = Math.min(100, Number(matched[1])) / 100
      continue
    }
    // A continuation: more of the guess if one is open, else more of the entry (sub-bullets keep their dash).
    const more = line.replace(/^ {1,4}/, '')
    if (current.guess && /^\s{4,}/.test(line)) current.guess.text += `\n${more.trim()}`
    else current.text += `\n${more}`
  }
  return entries
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])
}

/** How close a guess was to the real answer: shared words over all words (0..1). Crude on purpose: a number to watch, not a verdict. */
export function guessMatch(guess: string, actual: string): number {
  const a = words(guess)
  const b = words(actual)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return Math.round((shared / (a.size + b.size - shared)) * 100) / 100
}

export interface MissionLogInput {
  /** `2026-11-10 14:02` (the caller's clock). */
  at: string
  who: string
  text: string
  /** The carbon answer: what the writer expects `guess.who` to reply. */
  guess?: { who: string; text: string } | null
}

function oneBlock(text: string, indent: string): string {
  return text.replace(/\r\n?/g, '\n').trim().split('\n').map(line => line.trimEnd()).filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join(`\n${indent}`)
}

/**
 * Add an entry at the end of the log (the section is created when missing). When the entry answers
 * an open guess (the last guess addressed to this writer that nobody answered yet), it also records
 * how close the guess was.
 */
export function appendMissionLog(markdown: string, input: MissionLogInput): string {
  const who = input.who.replace(/[:\n]/g, ' ').trim() || 'someone'
  const text = oneBlock(input.text, '  ')
  if (!text) return markdown
  const lines = [`- ${input.at} · ${who}: ${text}`]
  if (input.guess?.text.trim()) {
    lines.push(`  - guess (${input.guess.who.replace(/[()\n]/g, ' ').trim() || 'owner'}): ${oneBlock(input.guess.text, '    ')}`)
  }
  // Does this answer a guess? The latest entry with a guess for this writer, with no entry by them after it.
  const entries = parseMissionLog(markdown)
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.who.toLowerCase() === who.toLowerCase()) break
    if (entry.guess && entry.guess.who.toLowerCase() === who.toLowerCase()) {
      lines.push(`  - guess match: ${Math.round(guessMatch(entry.guess.text, input.text) * 100)}%`)
      break
    }
  }
  const { before, log, after } = splitMissionLog(markdown)
  const kept = (log || []).join('\n').replace(/\s+$/, '')
  const section = `## Log\n${kept ? `${kept}\n` : ''}${lines.join('\n')}\n`
  return `${before.replace(/\s+$/, '')}\n\n${section}${after ? `\n${after.replace(/^\n+/, '')}` : ''}`
}

// ─── the header ─────────────────────────────────────────────────────────────

export interface MissionHeaderPatch {
  state?: string
  who?: string
  doneWhen?: string
  ease?: number
  impact?: number
  urgency?: number
}

export const MISSION_STATES = ['idea', 'agreed', 'doing', 'shipped', 'verified']

function clampScore(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)))
}

/**
 * Change header lines in place. Lines the patch doesn't name, and any the Oasis doesn't know, stay
 * as they are; a missing line is added at the end of the header. Returns the new text and, in words,
 * what changed (for the log, so scores have a history to learn from).
 */
export function setMissionHeader(markdown: string, patch: MissionHeaderPatch): { markdown: string; changes: string[] } {
  const lines = markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  let end = 0
  while (end < lines.length && lines[end].trim() && lines[end].includes(':') && !lines[end].startsWith('#')) end += 1
  const header = lines.slice(0, end)
  const rest = lines.slice(end)
  const find = (key: string) => header.findIndex(line => line.slice(0, line.indexOf(':')).trim().toLowerCase() === key)
  const read = (key: string) => {
    const at = find(key)
    return at < 0 ? '' : header[at].slice(header[at].indexOf(':') + 1).trim()
  }
  const write = (key: string, value: string) => {
    const at = find(key)
    if (at < 0) header.push(`${key}: ${value}`)
    else header[at] = `${key}: ${value}`
  }
  const clean = (value: string) => value.replace(/\s*\n\s*/g, ' ').trim()
  const changes: string[] = []

  if (patch.state !== undefined && clean(patch.state) && clean(patch.state) !== read('state')) {
    changes.push(`state ${read('state') || 'idea'} → ${clean(patch.state)}`)
    write('state', clean(patch.state))
  }
  if (patch.who !== undefined && clean(patch.who) !== read('who')) {
    changes.push(`who: ${read('who') || 'nobody'} → ${clean(patch.who) || 'nobody'}`)
    write('who', clean(patch.who))
  }
  if (patch.doneWhen !== undefined && clean(patch.doneWhen) !== read('done when')) {
    changes.push('done when rewritten')
    write('done when', clean(patch.doneWhen))
  }
  if (patch.ease !== undefined || patch.impact !== undefined || patch.urgency !== undefined) {
    const old: Record<string, number> = {}
    for (const match of read('score').matchAll(/(ease|impact|urgency)\s*(\d)/g)) old[match[1]] = Number(match[2])
    const next = {
      ease: clampScore(patch.ease ?? old.ease ?? 3),
      impact: clampScore(patch.impact ?? old.impact ?? 3),
      urgency: clampScore(patch.urgency ?? old.urgency ?? 3),
    }
    const moved = (['ease', 'impact', 'urgency'] as const).filter(key => old[key] !== next[key])
    if (moved.length) {
      changes.push(...moved.map(key => `${key} ${old[key] ?? '–'} → ${next[key]}`))
      write('score', `ease ${next.ease} · impact ${next.impact} · urgency ${next.urgency}`)
    }
  }
  if (!changes.length) return { markdown, changes }
  // A file that had no header gets a blank line between the new header and its text.
  const body = rest.length && rest[0].trim() ? ['', ...rest] : rest
  return { markdown: [...header, ...body].join('\n'), changes }
}

/** `my-new-mission.md` from a title. */
export function missionFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${slug || 'mission'}.md`
}

/** A new mission's text: today's header, a title, an empty log. */
export function newMissionMarkdown(title: string, who: string, at: string): string {
  return `state: idea\nwho: ${who.replace(/\n/g, ' ').trim() || 'owner'}\ndone when: \nscore: ease 3 · impact 3 · urgency 3\n\n# ${title.replace(/\n/g, ' ').trim()}\n\n## Log\n- ${at} · ${who.replace(/[:\n]/g, ' ').trim() || 'owner'}: Created in the Oasis.\n`
}
