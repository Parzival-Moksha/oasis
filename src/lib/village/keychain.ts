// ░▒▓ ACADEMY KEYCHAIN — every key an agent can hold, and which of them are held ▓▒░
// Pure: the rules for finding a key on this machine, `.env` parsing that returns NAMES only, the state of
// each key, which skills it opens, and how a pasted value is written into a `.env` line.
// No fs, no processes (keychain-server.ts does those), and no function here ever returns a value.
//
// Words matter (the owner was explicit): a Claude or ChatGPT login is an OAuth token a subscription gives
// the CLI, not an API key. Subscriptions are gold, API keys blue.

import type { AcademyKey, AcademyKeyKind, AcademySkill } from './village-academy'
import { featuresForKey } from '../feature-keys'

export type KeyState = 'have' | 'missing' | 'unknown'

/** Where a key was found. Never a value. */
export interface KeyFound {
  source: 'env-file' | 'environment' | 'login' | 'plugin' | 'marked'
  /** What to show: "Claude CLI login (claude.ai, max)", "Claude plugin: vercel", "marked by you"... */
  label: string
  /** An `.env` file's path. */
  file?: string
  /** The variable's name. */
  name?: string
}

export interface KeyRule {
  /** Variable names it is kept under. */
  env?: string[]
  /** A CLI that holds a login for it. */
  login?: 'claude' | 'codex' | 'gh'
  /** An installed Claude plugin whose name matches. */
  plugin?: RegExp
}

/**
 * What can be detected on this machine, by key id. Keys not named here (a card, a Raspberry Pi) cannot be
 * detected: they are "unknown" until the owner marks them. Further names can come with the key itself
 * (the content's `env` field).
 */
export const KEY_RULES: Record<string, KeyRule> = {
  claude: { login: 'claude' },
  chatgpt: { login: 'codex' },
  anthropic: { env: ['ANTHROPIC_API_KEY'] },
  openai: { env: ['OPENAI_API_KEY'] },
  openrouter: { env: ['OPENROUTER_API_KEY'] },
  google: { env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] },
  xai: { env: ['XAI_API_KEY'] },
  elevenlabs: { env: ['ELEVENLABS_API_KEY'] },
  groq: { env: ['GROQ_API_KEY'] },
  deepgram: { env: ['DEEPGRAM_API_KEY'] },
  assemblyai: { env: ['ASSEMBLYAI_API_KEY'] },
  mistral: { env: ['MISTRAL_API_KEY'] },
  speechmatics: { env: ['SPEECHMATICS_API_KEY'] },
  stability: { env: ['STABILITY_API_KEY'] },
  minimax: { env: ['MINIMAX_API_KEY'] },
  giphy: { env: ['GIPHY_API_KEY'] },
  telegram: { env: ['TELEGRAM_BOT_TOKEN'] },
  agentmail: { env: ['AGENTMAIL_API_KEY'] },
  twilio: { env: ['TWILIO_AUTH_TOKEN'] },
  telnyx: { env: ['TELNYX_API_KEY'] },
  vercel: { env: ['VERCEL_TOKEN'], plugin: /vercel/i },
  netlify: { env: ['NETLIFY_AUTH_TOKEN'], plugin: /netlify/i },
  supabase: { env: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY'], plugin: /supabase/i },
  resend: { env: ['RESEND_API_KEY'] },
  stripe: { env: ['STRIPE_SECRET_KEY'], plugin: /stripe/i },
  github: { env: ['GITHUB_TOKEN', 'GH_TOKEN'], login: 'gh', plugin: /github/i },
  pixabay: { env: ['PIXABAY_API_KEY'] },
  coverr: { env: ['COVERR_API_KEY'] },
  // The two keys of the sample set (af_oasis ships three sample skills).
  'claude-plan': { login: 'claude' },
  'api-key': { env: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'] },
}

/**
 * A name a key may be stored under: a secret's name (…_KEY, …_TOKEN, …_SECRET), never one that changes how
 * the Oasis runs or ends up in the browser's code. The content's own `env` names pass the same check, since
 * agents can write that folder.
 */
export function isKeyEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(name)
    && /_(KEY|TOKEN|SECRET)$/.test(name)
    && !/^(NEXT_|NODE_|OASIS_|NPM_|__)/.test(name)
}

/** The variable names a key can be stored under: its rule's, then the content's own. */
export function keyEnvNames(key: Pick<AcademyKey, 'id' | 'env'>): string[] {
  return [...new Set([...(KEY_RULES[key.id]?.env || []), ...(key.env || [])])].filter(isKeyEnvName)
}

// ─── `.env` files: names only ───────────────────────────────────────────────

export interface EnvEntry {
  name: string
  /** Has something after the "=": an empty `KEY=` is not a key. The value itself is never kept. */
  filled: boolean
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

/** The variables an `.env` text assigns, and whether each has a value. Nothing else leaves this function. */
export function parseEnvNames(text: string): EnvEntry[] {
  const out: EnvEntry[] = []
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue
    const match = ASSIGNMENT.exec(line)
    if (!match) continue
    let value = match[2].trim()
    // Unquoted: a `#` at the start or after a space begins a comment (`KEY= # later` is empty).
    if (!/^["']/.test(value)) value = value.replace(/(^|\s+)#.*$/, '').trim()
    else value = value.replace(/^(["'])(.*?)\1.*$/, '$2').trim()
    out.push({ name: match[1], filled: value.length > 0 })
  }
  return out
}

/**
 * A value as an `.env` line wants it, so that Next reads back exactly what was pasted: bare when it is
 * plain, single-quoted otherwise, double-quoted when it has a single quote. Next expands `$NAME` and
 * `${NAME}` inside every kind of quote (dotenv-expand), so each `$` is written as `\$`. Refused (null)
 * when it cannot round-trip: a line break, a backslash right before a `$`, or a value with a single
 * quote plus a double quote, a backtick or a backslash.
 */
export function formatEnvValue(value: string): string | null {
  if (!value || value.length > 4000 || /[\r\n\0\v\f]/.test(value)) return null
  if (/\\\$/.test(value)) return null
  if (/^[A-Za-z0-9_\-./+=:@~,%]+$/.test(value)) return value
  const escaped = value.replace(/\$/g, '\\$')
  if (!value.includes("'")) return `'${escaped}'`
  if (!/["`\\]/.test(value)) return `"${escaped}"`
  return null
}

/**
 * The `.env` text with `name` set: every assignment of it is replaced in place (the last one is the one
 * that counts, so all of them), keeping an `export ` in front; a commented line is left alone. None: one is
 * added at the end. Line endings and every other line stay as they were.
 */
export function setEnvValue(text: string, name: string, formatted: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('not a variable name')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const assignment = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`)
  let replaced = false
  for (let index = 0; index < lines.length; index += 1) {
    const match = assignment.exec(lines[index])
    if (!match) continue
    lines[index] = `${match[1] || ''}${name}=${formatted}`
    replaced = true
  }
  if (replaced) return lines.join(eol)
  const body = text.length === 0 || text.endsWith('\n') ? text : text + eol
  return `${body}${name}=${formatted}${eol}`
}

// ─── what was found on this machine ─────────────────────────────────────────

export interface KeychainFacts {
  /** `.env` files that were read: their path and the names they assign. */
  envFiles: Array<{ file: string; names: EnvEntry[] }>
  /** Names of variables set in the Oasis's own environment (loaded from its .env or the system's). */
  environment: string[]
  /** null: the CLI is not there or did not answer. */
  logins: {
    claude: { loggedIn: boolean; method: string; plan: string } | null
    codex: { loggedIn: boolean; method: string } | null
    gh: { loggedIn: boolean } | null
  }
  /** Names of installed Claude plugins. */
  plugins: string[]
  /** Keys the owner marked as held. */
  marks: Record<string, { at: number }>
}

export interface KeychainKeyView {
  id: string
  name: string
  short: string
  kind: AcademyKeyKind
  cost: string
  link: string
  note: string
  state: KeyState
  found: KeyFound[]
  /** Names it can be stored under: empty for keys you cannot paste (a login, an account, hardware). */
  envNames: string[]
  /** Can be marked as held by hand (everything but API keys, which are stored instead). */
  canMark: boolean
  marked: boolean
  /** The skills that list it, and whether each is open now (no key needed, or any key it lists is held). */
  skills: Array<{ id: string; name: string; open: boolean }>
  /** The Oasis's own spells it opens (Text to Pic...). */
  spells: string[]
}

function folderOf(file: string): string {
  const parts = file.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : file
}

/** Where one key was found, from the facts. */
export function findKey(key: AcademyKey, facts: KeychainFacts): KeyFound[] {
  const rule = KEY_RULES[key.id]
  const found: KeyFound[] = []
  const names = keyEnvNames(key)
  const seen = new Set<string>()
  for (const file of facts.envFiles) {
    for (const entry of file.names) {
      if (!entry.filled || !names.includes(entry.name)) continue
      const id = `${file.file}|${entry.name}`
      if (seen.has(id)) continue
      seen.add(id)
      found.push({ source: 'env-file', label: `${entry.name} in ${folderOf(file.file)}/${file.file.split(/[\\/]/).pop()}`, file: file.file, name: entry.name })
    }
  }
  for (const name of names) {
    // The Oasis's own environment includes what it loaded from its .env: mention it only when no file shows it.
    if (facts.environment.includes(name) && !found.some(item => item.name === name)) found.push({ source: 'environment', label: `${name} in the environment`, name })
  }
  const login = rule?.login
  if (login === 'claude' && facts.logins.claude?.loggedIn && facts.logins.claude.method === 'claude.ai') {
    found.push({ source: 'login', label: `Claude CLI login (claude.ai${facts.logins.claude.plan ? `, ${facts.logins.claude.plan}` : ''})` })
  }
  if (login === 'codex' && facts.logins.codex?.loggedIn && /chatgpt/i.test(facts.logins.codex.method)) found.push({ source: 'login', label: 'Codex CLI login (ChatGPT)' })
  if (login === 'gh' && facts.logins.gh?.loggedIn) found.push({ source: 'login', label: 'GitHub CLI login' })
  if (rule?.plugin) {
    const plugin = facts.plugins.find(name => rule.plugin!.test(name))
    if (plugin) found.push({ source: 'plugin', label: `Claude plugin: ${plugin}` })
  }
  // A mark stands for a plan, an account or a machine; an API key is held when it is stored somewhere.
  if (facts.marks[key.id] && key.kind !== 'api') found.push({ source: 'marked', label: 'marked as held by you' })
  return found
}

/** have: found. missing: it can be looked for and was not there. unknown: nothing here can see it. */
export function keyState(key: AcademyKey, found: KeyFound[], facts: KeychainFacts): KeyState {
  if (found.length) return 'have'
  const rule = KEY_RULES[key.id]
  if (keyEnvNames(key).length) return 'missing'
  if (rule?.login && facts.logins[rule.login] !== null) return 'missing'
  if (rule?.plugin) return 'missing'
  return 'unknown'
}

/** A skill is open when it needs no key, or holds any one of the keys it lists. */
export function skillOpen(skill: Pick<AcademySkill, 'keys'>, held: Set<string>): boolean {
  return skill.keys.length === 0 || skill.keys.some(id => held.has(id))
}

export function buildKeychain(keys: AcademyKey[], skills: AcademySkill[], facts: KeychainFacts): KeychainKeyView[] {
  const found = new Map(keys.map(key => [key.id, findKey(key, facts)]))
  const states = new Map(keys.map(key => [key.id, keyState(key, found.get(key.id) || [], facts)]))
  const held = new Set(keys.filter(key => states.get(key.id) === 'have').map(key => key.id))
  return keys.map(key => ({
    id: key.id,
    name: key.name,
    short: key.short,
    kind: key.kind,
    cost: key.cost,
    link: key.link,
    note: key.note || '',
    state: states.get(key.id) || 'unknown',
    found: found.get(key.id) || [],
    envNames: keyEnvNames(key),
    canMark: key.kind !== 'api',
    marked: Boolean(facts.marks[key.id]),
    skills: skills.filter(skill => skill.keys.includes(key.id)).slice(0, 80).map(skill => ({ id: skill.id, name: skill.name, open: skillOpen(skill, held) })),
    spells: featuresForKey(key.id),
  }))
}

/** What the map's key gems show: a key is lit when held, dim when missing. */
export function keyStateMap(keys: Array<Pick<KeychainKeyView, 'id' | 'state'>>): Map<string, KeyState> {
  return new Map(keys.map(key => [key.id, key.state]))
}

export const KEY_KIND_WORD: Record<AcademyKeyKind, string> = { subscription: 'subscription', api: 'API key', account: 'account', hardware: 'hardware' }

/** One line on what each kind is: the words the owner asked for. */
export const KEY_KIND_ABOUT: Record<AcademyKeyKind, string> = {
  subscription: 'A plan you pay for and sign in with. The tool stores a login (an OAuth token), not an API key.',
  api: 'A secret you paste into the agent\'s settings. You pay for what it uses.',
  account: 'A service you have an account with, often a login rather than a key.',
  hardware: 'A machine, a phone or a card: nothing to paste.',
}
