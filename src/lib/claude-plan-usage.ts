// ░▒▓ CLAUDE PLAN USAGE — the plan limits Claude Code's /usage shows, for the Profile ▓▒░
// `claude -p /usage` answers locally at no cost (a synthetic reply, total_cost_usd 0) with the same lines as the
// app's usage page: "Current week (all models): 46% used · resets Nov 20, 7:59am (Europe/Budapest)", one per
// window it tracks (the 5-hour session, the week, the week per model such as Fable). The account is the one that
// CLI is logged into: oauthAccount in its config (~/.claude.json, or $CLAUDE_CONFIG_DIR/.claude.json), the
// same login the village's agents run with unless the engine was started with another CLAUDE_CONFIG_DIR.
// Server-side only; the route is local only.

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { resolveClaudeCli } from './claude-bin'
import { buildClaudeCliEnv } from './claude-cli-env'

export interface PlanWindow {
  /** As the CLI says it: "week (all models)", "week (Fable)", "session". */
  key: string
  /** For the panel: "Week · all models", "Week · Fable", "Session (5 h)". */
  label: string
  percent: number
  /** As the CLI says it, in the owner's time zone: "Nov 20, 7:59am". */
  resetsText: string | null
  timeZone: string | null
  /** When it resets (ms), or null when the text can't be read. */
  resetsAt: number | null
}

export interface PlanAccount {
  email: string | null
  name: string | null
  plan: string | null
  organization: string | null
  /** Where this login lives (the CLI's config folder). */
  configDir: string
}

export interface PlanUsage {
  ok: boolean
  account: PlanAccount | null
  windows: PlanWindow[]
  /** The CLI runs on the subscription (not an API key). */
  subscription: boolean | null
  checkedAt: number
  error?: string
}

// The separator is a middle dot, which a wrong code page turns into "Â·": one to three non-word characters.
const LINE = /^Current ([^:\n]+):\s*(\d+(?:\.\d+)?)% used(?:\s*[^\s\w]{1,3}\s*resets\s+([^(\n]+?))?(?:\s*\(([^)\n]+)\))?\s*$/gm
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function windowLabel(key: string): string {
  const k = key.trim()
  const week = /^week\s*\((.+)\)$/i.exec(k)
  if (week) return `Week · ${week[1].trim()}`
  if (/^week$/i.test(k)) return 'Week'
  if (/session/i.test(k)) return 'Session (5 h)'
  return k.charAt(0).toUpperCase() + k.slice(1)
}

/** "Nov 20, 7:59am" or "3pm" (today) in local time -> ms, or null. */
export function parseResetsText(text: string | null, now = new Date()): number | null {
  if (!text) return null
  const t = text.trim().toLowerCase()
  const full = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?$/.exec(t)
  const timeOnly = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(t)
  let month: number
  let day: number
  let hour = 0
  let minute = 0
  let ampm: string | undefined
  if (full) {
    month = MONTHS.indexOf(full[1])
    day = Number(full[2])
    if (full[3]) { hour = Number(full[3]); minute = Number(full[4] || 0); ampm = full[5] }
  } else if (timeOnly) {
    month = now.getMonth()
    day = now.getDate()
    hour = Number(timeOnly[1]); minute = Number(timeOnly[2] || 0); ampm = timeOnly[3]
  } else {
    return null
  }
  if (month < 0) return null
  if (ampm) hour = (hour % 12) + (ampm === 'pm' ? 12 : 0)
  let at = new Date(now.getFullYear(), month, day, hour, minute).getTime()
  // "Jan 3" seen in December is next year; a time-only reset already past today is tomorrow.
  if (at < now.getTime() - 86_400_000) at = full ? new Date(now.getFullYear() + 1, month, day, hour, minute).getTime() : at + 86_400_000
  else if (!full && at < now.getTime()) at += 86_400_000
  return at
}

export function parsePlanUsage(text: string, now = new Date()): { windows: PlanWindow[]; subscription: boolean | null } {
  const windows: PlanWindow[] = []
  for (const m of text.matchAll(LINE)) {
    const resetsText = m[3]?.trim() || null
    windows.push({ key: m[1].trim(), label: windowLabel(m[1]), percent: Number(m[2]), resetsText, timeZone: m[4]?.trim() || null, resetsAt: parseResetsText(resetsText, now) })
  }
  const subscription = /using your subscription/i.test(text) ? true : /api key|console/i.test(text) ? false : null
  return { windows, subscription }
}

export async function readPlanAccount(env: NodeJS.ProcessEnv = process.env): Promise<PlanAccount | null> {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || os.homedir()
  const file = env.CLAUDE_CONFIG_DIR?.trim() ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json')
  try {
    const config = JSON.parse(await fs.readFile(file, 'utf8')) as { oauthAccount?: Record<string, unknown> }
    const a = config.oauthAccount || {}
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return { email: str(a.emailAddress), name: str(a.displayName) || str(a.fullName), plan: str(a.planDisplayName), organization: str(a.organizationName), configDir: env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude') }
  } catch {
    return null
  }
}

function runUsageCommand(timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli = resolveClaudeCli()
    const child = spawn(cli.command, [...cli.prefixArgs, '-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--max-turns', '1'], {
      cwd: os.tmpdir(),
      shell: cli.shell,
      env: buildClaudeCliEnv(),
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude Code took too long to answer /usage')) }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString('utf8')).slice(-1000) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const data = JSON.parse(out.trim().split('\n').pop() || '{}') as { result?: string; is_error?: boolean }
        if (data.is_error || typeof data.result !== 'string') return reject(new Error(String(data.result || err.trim().split('\n').pop() || 'no answer')))
        resolve(data.result)
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'Claude Code gave no usable answer'))
      }
    })
    child.stdin.end('/usage')
  })
}

let cached: PlanUsage | null = null
let pending: Promise<PlanUsage> | null = null
const CACHE_MS = 60_000

/** The plan limits (cached a minute; `fresh` asks again). Never throws: errors come back as { ok: false, error }. */
export function getPlanUsage(fresh = false): Promise<PlanUsage> {
  if (!fresh && cached && Date.now() - cached.checkedAt < CACHE_MS) return Promise.resolve(cached)
  if (pending) return pending
  pending = (async () => {
    const account = await readPlanAccount()
    try {
      const text = await runUsageCommand()
      const { windows, subscription } = parsePlanUsage(text)
      cached = { ok: true, account, windows, subscription, checkedAt: Date.now(), ...(windows.length ? {} : { error: 'Claude Code /usage listed no limits' }) }
    } catch (error) {
      cached = { ok: false, account, windows: [], subscription: null, checkedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
    }
    return cached
  })().finally(() => { pending = null })
  return pending
}
