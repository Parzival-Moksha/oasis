// Where this machine keeps things (server side). The same file the agent engine reads
// (packages/oasis-agent-engine/src/settings.js): data/oasis-settings.local.json, not in git.
// An environment variable wins over the file. Read fresh when the file changed, so no restart is needed.
import fs from 'node:fs'
import path from 'node:path'

export type OasisSettingKey = 'missionsDir' | 'grillFile' | 'academyDir' | 'anorakProCwd'

const ENV: Record<OasisSettingKey, string> = {
  missionsDir: 'OASIS_MISSIONS_DIR',
  grillFile: 'OASIS_GRILL_FILE',
  academyDir: 'OASIS_ACADEMY_DIR',
  anorakProCwd: 'OASIS_ANORAK_PRO_CWD',
}

export function settingsFile(): string {
  return process.env.OASIS_SETTINGS_FILE || path.join(process.cwd(), 'data', 'oasis-settings.local.json')
}

let cache: { file: string; mtime: number; value: Record<string, unknown> } = { file: '', mtime: -1, value: {} }

function fileSettings(): Record<string, unknown> {
  const file = settingsFile()
  try {
    const mtime = fs.statSync(file).mtimeMs
    if (file !== cache.file || mtime !== cache.mtime) cache = { file, mtime, value: (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) || {} }
    return cache.value
  } catch {
    return {}
  }
}

/** One place, or '' when this machine has none. */
export function oasisSetting(key: OasisSettingKey): string {
  const fromEnv = process.env[ENV[key]]
  if (fromEnv) return fromEnv.trim()
  const value = fileSettings()[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** The mission board's folder: this machine's setting, else data/missions inside the Oasis folder. */
export function missionsDir(): string {
  return oasisSetting('missionsDir') || path.join(process.cwd(), 'data', 'missions')
}

/** The Academy's skill tree: this machine's setting, else data/academy (absent: the built-in sample). */
export function academyDirSetting(): string {
  return oasisSetting('academyDir') || path.join(process.cwd(), 'data', 'academy')
}
