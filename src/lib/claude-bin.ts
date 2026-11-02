// ░▒▓ CLAUDE CLI LAUNCHER ▓▒░
// Node 22 refuses to spawn .cmd/.bat files without a shell (spawn EINVAL), and a
// shell flashes a console window on Windows. The npm shim `claude.cmd` only runs
//   %APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe %*
// so resolve that target and spawn it directly. Ported from the 7c_oasis spike.

import fs from 'fs'
import path from 'path'

export interface ClaudeCli {
  command: string
  prefixArgs: string[]
  /** true only for the last-resort `claude.cmd` fallback */
  shell: boolean
}

let cached: ClaudeCli | null = null

export function resolveClaudeCli(): ClaudeCli {
  if (cached) return cached
  const override = process.env.OASIS_CLAUDE_BIN
  if (override) {
    cached = override.endsWith('.js')
      ? { command: process.execPath, prefixArgs: [override], shell: false }
      : { command: override, prefixArgs: [], shell: false }
    return cached
  }
  if (process.platform !== 'win32') return (cached = { command: 'claude', prefixArgs: [], shell: false })

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const exe = path.join(dir, 'claude.exe')
    if (fs.existsSync(exe)) return (cached = { command: exe, prefixArgs: [], shell: false })
  }
  for (const dir of dirs) {
    const shim = path.join(dir, 'claude.cmd')
    if (!fs.existsSync(shim)) continue
    const match = fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+?\.(exe|js|cjs|mjs))"/i)
    const target = match ? path.join(dir, match[1]) : ''
    if (target && fs.existsSync(target)) {
      cached = /\.exe$/i.test(target)
        ? { command: target, prefixArgs: [], shell: false }
        : { command: process.execPath, prefixArgs: [target], shell: false }
      return cached
    }
    return (cached = { command: shim, prefixArgs: [], shell: true })
  }
  return (cached = { command: 'claude.cmd', prefixArgs: [], shell: true })
}
