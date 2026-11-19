// ░▒▓ KEYCHAIN, SERVER SIDE — looks for keys on this machine, stores one the owner pastes ▓▒░
// What it reads: the NAMES in the Oasis's `.env` files and in the folders the village's agents work in
// (and whether a name has a value, never the value), `claude auth status`, `codex login status`,
// `gh auth status` (the exit code), the installed Claude plugins' names.
// What it never does: put a value into a response, a log line or an error message, send one to an agent,
// or write one anywhere but the Oasis's own `.env`. The only value that passes through here is the one
// the owner pastes (POST store), and it goes from the request to that file and into process.env.

import { execFile } from 'node:child_process'
import fsSync from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveClaudeCli } from './claude-bin'
import { buildClaudeCliEnv } from './claude-cli-env'
import { loadAcademySets } from './academy-server'
import { OASIS_FEATURE_KEYS } from './feature-keys'
import {
  buildKeychain,
  formatEnvValue,
  keyEnvNames,
  parseEnvNames,
  setEnvValue,
  type KeychainFacts,
  type KeychainKeyView,
} from './village/keychain'
import type { AcademyKey, AcademySkill } from './village/village-academy'

const ENV_FILES = ['.env', '.env.local']
const MAX_ENV_BYTES = 256 * 1024
const MAX_FOLDERS = 40
const SCAN_TTL_MS = 45_000

export interface KeychainPaths {
  /** The Oasis's own folder: its `.env` is the one a pasted key is written to. */
  root: string
  home: string
  /** Where the keychain keeps the marks. */
  state: string
  /** The agent roster, for the folders the agents work in. */
  roster: string
  /** Folders to look in besides the roster's. */
  extraFolders?: string[]
}

export function defaultKeychainPaths(): KeychainPaths {
  const root = process.cwd()
  return {
    root,
    home: os.homedir(),
    state: process.env.OASIS_KEYCHAIN_STATE || path.join(root, 'data', 'keychain.local.json'),
    roster: path.join(root, 'data', 'agent-engine.local.json'),
  }
}

export type RunResult = { code: number | null; stdout: string; stderr?: string } | null
export type RunCommand = (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<RunResult>

/**
 * `codex` on Windows is an npm shim (codex.cmd) that Node cannot spawn without a shell: run the script it
 * points at with this process's node instead, as claude-bin.ts does for claude.
 */
let codexCli: { command: string; prefixArgs: string[] } | null = null

export function resolveCodex(): { command: string; prefixArgs: string[] } {
  // Looked up once: PATH can hold an offline share, and these checks are synchronous.
  if (!codexCli) codexCli = findCodex()
  return codexCli
}

function findCodex(): { command: string; prefixArgs: string[] } {
  if (process.platform !== 'win32') return { command: 'codex', prefixArgs: [] }
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(dir => dir && !isNetworkPath(dir))) {
    const shim = path.join(dir, 'codex.cmd')
    try {
      if (!fsSync.existsSync(shim)) continue
      // The shim also names node.exe ("use the node next to me"): the script it runs is the other one.
      const names = [...fsSync.readFileSync(shim, 'utf8').matchAll(/"%dp0%\\([^"]+?\.(?:exe|js|cjs|mjs))"/gi)].map(match => match[1]).filter(name => !/(^|\\)node\.exe$/i.test(name))
      const target = names.length ? path.join(dir, names[0]) : ''
      if (target && fsSync.existsSync(target)) return /\.exe$/i.test(target) ? { command: target, prefixArgs: [] } : { command: process.execPath, prefixArgs: [target] }
    } catch { /* unreadable shim: try the next folder */ }
  }
  return { command: 'codex', prefixArgs: [] }
}

/** `\\server\share` and `//server/share`: a folder that can hang for a long time when the server is away. */
export function isNetworkPath(folder: string): boolean {
  return /^(\\\\|\/\/)/.test(folder)
}

const COMMAND_TIMEOUT_MS = 8000

/**
 * A command with a time limit, no console window, no shell. null: it is not there or it did not answer.
 * On a timeout the whole process tree goes (a node wrapper such as codex.js starts its own codex.exe).
 */
export const runCommand: RunCommand = (command, args, env) => new Promise(resolve => {
  let done = false
  const finish = (result: RunResult) => {
    if (done) return
    done = true
    clearTimeout(timer)
    resolve(result)
  }
  let child: ReturnType<typeof execFile> | null = null
  const timer = setTimeout(() => {
    const pid = child?.pid
    if (pid && process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
    else child?.kill('SIGKILL')
    finish(null)
  }, COMMAND_TIMEOUT_MS)
  try {
    child = execFile(command, args, { windowsHide: true, env: env || process.env, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return finish(null)
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as unknown as { code: number }).code : 1) : 0
      finish({ code, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  } catch {
    finish(null)
  }
})

// ─── marks ──────────────────────────────────────────────────────────────────

async function readMarks(file: string): Promise<Record<string, { at: number }>> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  try {
    const raw = JSON.parse(text.replace(/^﻿/, '')) as { have?: Record<string, { at?: unknown }> }
    const out: Record<string, { at: number }> = {}
    for (const [id, value] of Object.entries(raw.have || {})) {
      if (/^[a-z0-9][a-z0-9_-]{0,60}$/i.test(id)) out[id] = { at: typeof value?.at === 'number' ? value.at : 0 }
    }
    return out
  } catch {
    // Not JSON: an error, so the next write cannot replace the file with an empty one.
    throw new Error('data/keychain.local.json is not valid JSON: fix it or move it away (nothing was written)')
  }
}

async function writeFileAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, text, 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temp, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.unlink(temp).catch(() => {})
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

// ─── scanning ───────────────────────────────────────────────────────────────

async function agentFolders(paths: KeychainPaths): Promise<string[]> {
  const folders = new Set<string>([paths.root, ...(paths.extraFolders || [])])
  try {
    const roster = JSON.parse((await fs.readFile(paths.roster, 'utf8')).replace(/^﻿/, '')) as { agents?: Array<{ cwd?: unknown }> }
    for (const agent of roster.agents || []) {
      // Network folders are skipped: a share that is away can stall the scan for a long time.
      if (typeof agent.cwd === 'string' && path.isAbsolute(agent.cwd) && !isNetworkPath(agent.cwd)) folders.add(path.normalize(agent.cwd))
    }
  } catch { /* no roster yet */ }
  return [...folders].slice(0, MAX_FOLDERS)
}

const FOLDER_TIMEOUT_MS = 2500

async function readFolderEnv(folder: string): Promise<KeychainFacts['envFiles']> {
  const out: KeychainFacts['envFiles'] = []
  for (const name of ENV_FILES) {
    const file = path.join(folder, name)
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_ENV_BYTES) continue
      // The text is read, reduced to names and dropped in the same expression.
      out.push({ file, names: parseEnvNames(await fs.readFile(file, 'utf8')) })
    } catch { /* no such file */ }
  }
  return out
}

/** Every folder at once, each with a time limit: a slow drive leaves its files out instead of holding the scan. */
async function readEnvFiles(folders: string[]): Promise<KeychainFacts['envFiles']> {
  const unique = [...new Map(folders.map(folder => [folder.toLowerCase(), folder])).values()]
  const results = await Promise.all(unique.map(folder => Promise.race([
    readFolderEnv(folder),
    new Promise<KeychainFacts['envFiles']>(resolve => setTimeout(() => resolve([]), FOLDER_TIMEOUT_MS)),
  ])))
  return results.flat()
}

/** `codex login status` says "Logged in using ChatGPT" (or an API key) on one of its streams. */
export function codexStatus(text: string, code: number | null): { loggedIn: boolean; method: string } {
  return { loggedIn: code === 0 && /logged in/i.test(text), method: /chatgpt/i.test(text) ? 'chatgpt' : /api key/i.test(text) ? 'api-key' : '' }
}

function parseClaude(stdout: string): KeychainFacts['logins']['claude'] {
  try {
    const raw = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown }
    // Only these three fields are kept: the answer also names an account and an organisation.
    return { loggedIn: raw.loggedIn === true, method: typeof raw.authMethod === 'string' ? raw.authMethod : '', plan: typeof raw.subscriptionType === 'string' ? raw.subscriptionType : '' }
  } catch {
    return null
  }
}

async function readPluginNames(home: string): Promise<string[]> {
  try {
    const raw = JSON.parse((await fs.readFile(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).replace(/^﻿/, '')) as { plugins?: Record<string, unknown> }
    return Object.keys(raw.plugins || {}).map(name => name.split('@')[0]).filter(Boolean).slice(0, 200)
  } catch {
    return []
  }
}

/** Every fact the keychain needs, from this machine. */
export async function scanFacts(paths: KeychainPaths, run: RunCommand = runCommand, env: NodeJS.ProcessEnv = process.env): Promise<KeychainFacts> {
  const cli = (() => { try { return resolveClaudeCli() } catch { return null } })()
  const cliEnv = buildClaudeCliEnv()
  const [folders, marks, plugins, claude, codex, gh] = await Promise.all([
    agentFolders(paths),
    readMarks(paths.state),
    readPluginNames(paths.home),
    cli ? run(cli.command, [...cli.prefixArgs, 'auth', 'status'], cliEnv) : Promise.resolve(null),
    (() => { const codexCli = resolveCodex(); return run(codexCli.command, [...codexCli.prefixArgs, 'login', 'status']) })(),
    run('gh', ['auth', 'status']),
  ])
  const envFiles = await readEnvFiles(folders)
  return {
    envFiles,
    environment: Object.entries(env).filter(([, value]) => typeof value === 'string' && value.length > 0).map(([name]) => name),
    logins: {
      claude: claude ? parseClaude(claude.stdout) : null,
      codex: codex ? codexStatus(`${codex.stdout}
${codex.stderr || ''}`, codex.code) : null,
      gh: gh ? { loggedIn: gh.code === 0 } : null,
    },
    plugins,
    marks,
  }
}

// ─── the snapshot ───────────────────────────────────────────────────────────

export interface KeychainSnapshot {
  scannedAt: number
  keys: KeychainKeyView[]
  /** What was looked at, for the footer. Counts and names, no values. */
  sources: { folders: number; envFiles: number; plugins: number; claudeLogin: string; codexLogin: string; ghLogin: string }
}

/** The keys of every set (the main set's first) and every skill of every set (the first definition of an id wins). */
async function allKeysAndSkills(): Promise<{ keys: AcademyKey[]; skills: AcademySkill[] }> {
  const sets = await loadAcademySets()
  const keys: AcademyKey[] = []
  const skills: AcademySkill[] = []
  for (const set of sets) {
    for (const key of set.content.keys) if (!keys.some(item => item.id === key.id)) keys.push(key)
    for (const skill of set.content.skills) if (!skills.some(item => item.id === skill.id)) skills.push(skill)
  }
  // The Oasis's own spells' keys (fal, Meshy, Tripo...): listed even when no Academy set names them.
  for (const key of OASIS_FEATURE_KEYS) if (!keys.some(item => item.id === key.id)) keys.push(key)
  return { keys, skills }
}

function sourcesOf(facts: KeychainFacts, folders: number): KeychainSnapshot['sources'] {
  const say = (value: { loggedIn: boolean } | null, extra: string) => (value === null ? 'not found' : value.loggedIn ? `logged in${extra}` : 'not logged in')
  return {
    folders,
    envFiles: facts.envFiles.length,
    plugins: facts.plugins.length,
    claudeLogin: say(facts.logins.claude, facts.logins.claude ? ` (${facts.logins.claude.method || 'unknown'}${facts.logins.claude.plan ? `, ${facts.logins.claude.plan}` : ''})` : ''),
    codexLogin: say(facts.logins.codex, facts.logins.codex ? ` (${facts.logins.codex.method || 'unknown'})` : ''),
    ghLogin: say(facts.logins.gh, ''),
  }
}

type FactsEntry = { at: number; key: string; facts: KeychainFacts; folders: number }

let cachedFacts: FactsEntry | null = null
/** One scan at a time: tabs, polls and "look again" that arrive meanwhile share it. */
let scanning: { key: string; promise: Promise<FactsEntry> } | null = null
/** "Look again" is honoured at most this often (a scan starts three CLIs). */
const FRESH_MIN_MS = 5000

async function scanEntry(paths: KeychainPaths, cacheKey: string, run?: RunCommand, env?: NodeJS.ProcessEnv): Promise<FactsEntry> {
  const [facts, folders] = await Promise.all([scanFacts(paths, run, env), agentFolders(paths)])
  return { at: Date.now(), key: cacheKey, facts, folders: folders.length }
}

export async function keychainSnapshot(options: { fresh?: boolean; paths?: KeychainPaths; run?: RunCommand; env?: NodeJS.ProcessEnv } = {}): Promise<KeychainSnapshot> {
  const paths = options.paths || defaultKeychainPaths()
  const cacheKey = `${paths.root}|${paths.state}`
  const injected = Boolean(options.paths || options.run || options.env)
  let entry: FactsEntry
  if (injected) {
    entry = await scanEntry(paths, cacheKey, options.run, options.env)
  } else {
    const now = Date.now()
    const cached = cachedFacts && cachedFacts.key === cacheKey ? cachedFacts : null
    const usable = cached && now - cached.at < (options.fresh ? FRESH_MIN_MS : SCAN_TTL_MS) ? cached : null
    if (usable) entry = usable
    else {
      if (!scanning || scanning.key !== cacheKey) {
        const promise = scanEntry(paths, cacheKey).finally(() => { if (scanning?.promise === promise) scanning = null })
        scanning = { key: cacheKey, promise }
      }
      entry = await scanning.promise
      cachedFacts = entry
    }
  }
  const { keys, skills } = await allKeysAndSkills()
  return { scannedAt: entry.at, keys: buildKeychain(keys, skills, entry.facts), sources: sourcesOf(entry.facts, entry.folders) }
}

/**
 * Write a `.env` file in place of the old one: through a symlink to the real file, keeping its permissions,
 * via a temporary file next to it (gitignored as *.tmp) renamed over it.
 */
async function writeEnvFile(target: string, text: string): Promise<void> {
  let real = target
  try {
    real = await fs.realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const mode = await fs.stat(real).then(stat => stat.mode & 0o777).catch(() => 0o600)
  const temp = `${real}.${process.pid}.tmp`
  await fs.writeFile(temp, text, { encoding: 'utf8', mode })
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temp, real)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.unlink(temp).catch(() => {})
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// ─── writes ─────────────────────────────────────────────────────────────────

export type KeychainAction =
  | { key: string; action: 'have' | 'unmark' }
  | { key: string; action: 'store'; value: string; name?: string }

export type KeychainResult = { ok: true; key: KeychainKeyView; warning?: string; file?: string; restart?: boolean } | { ok: false; status: number; error: string }

let queue: Promise<unknown> = Promise.resolve()

/**
 * Mark a key as held, take the mark back, or store a pasted value in the Oasis's `.env`.
 * Nothing in a result or an error carries the value.
 */
export function keychainAction(action: KeychainAction, options: { paths?: KeychainPaths; run?: RunCommand; env?: NodeJS.ProcessEnv } = {}): Promise<KeychainResult> {
  const run = queue.then(async (): Promise<KeychainResult> => {
    const paths = options.paths || defaultKeychainPaths()
    let warning: string | undefined
    let written: string | undefined
    const { keys } = await allKeysAndSkills()
    const key = keys.find(item => item.id === action.key)
    if (!key) return { ok: false, status: 404, error: `no key ${String(action.key).slice(0, 60)}` }

    if (action.action === 'have' || action.action === 'unmark') {
      if (action.action === 'have' && key.kind === 'api') return { ok: false, status: 400, error: `${key.name} is a key you paste: add its value instead of marking it` }
      const marks = await readMarks(paths.state)
      if (action.action === 'have') marks[key.id] = { at: Date.now() }
      else delete marks[key.id]
      await writeFileAtomic(paths.state, `${JSON.stringify({ v: 1, have: marks }, null, 2)}\n`)
    } else if (action.action === 'store') {
      const names = keyEnvNames(key)
      if (!names.length) return { ok: false, status: 400, error: `${key.name} is not something you paste: ${key.kind === 'subscription' ? 'sign in with the tool (its login is an OAuth token, not a key)' : 'mark it as held instead'}` }
      const name = action.name ? String(action.name) : names[0]
      if (!names.includes(name)) return { ok: false, status: 400, error: `${key.name} is stored as ${names.join(' or ')}` }
      const value = typeof action.value === 'string' ? action.value.trim() : ''
      const formatted = formatEnvValue(value)
      if (!formatted) return { ok: false, status: 400, error: 'that value cannot be written to a .env line as it is (it is empty, has a line break, a backslash right before a $, or both kinds of quote with a backslash)' }
      // `.env.local` wins over `.env`: when the name is already there, that is the line to change.
      const localFile = path.join(paths.root, '.env.local')
      const envFile = path.join(paths.root, '.env')
      let local: string | null
      let main: string | null
      try {
        [local, main] = await Promise.all([readText(localFile), readText(envFile)])
      } catch {
        return { ok: false, status: 500, error: 'could not read the Oasis .env files' }
      }
      const inLocal = local !== null && parseEnvNames(local).some(entry => entry.name === name)
      const inFiles = parseEnvNames(`${local || ''}\n${main || ''}`).some(entry => entry.name === name && entry.filled)
      const target = inLocal ? localFile : envFile
      await writeEnvFile(target, setEnvValue((inLocal ? local : main) || '', name, formatted))
      // Not put into this process's environment by hand: the Oasis's dev server reads its .env files again
      // when they change. A variable set outside the files (the system's) still wins over them.
      const environment = options.env || process.env
      if (!inFiles && typeof environment[name] === 'string' && environment[name]) {
        warning = `${name} is also set outside the Oasis's .env files (the system environment), and that one wins until it is removed or the Oasis is started without it.`
      }
      written = path.basename(target)
    } else {
      return { ok: false, status: 400, error: 'action must be have, unmark or store' }
    }

    // A scan that started before this change would answer with the old state: start a new one.
    cachedFacts = null
    scanning = null
    const snapshot = await keychainSnapshot({ ...options, fresh: true })
    const view = snapshot.keys.find(item => item.id === key.id)
    if (!view) return { ok: false, status: 500, error: 'the key vanished' }
    return { ok: true, key: view, ...(warning ? { warning } : {}), ...(written ? { file: written } : {}), ...(written && process.env.NODE_ENV === 'production' ? { restart: true } : {}) }
  })
  queue = run.catch(() => {})
  return run.catch((error): KeychainResult => ({ ok: false, status: 500, error: error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 200) : 'keychain failed' }))
}
