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

const cache = new Map<string, ClaudeCli>()

/**
 * Any npm-installed CLI (claude, codex): its real program, so it starts without a shell. On Windows the npm shim
 * `<name>.cmd` only runs its target (.exe, or a .js under node_modules): read that target from the shim.
 * `override`: a program to use instead (a .js runs with this node).
 */
export function resolveNpmCli(name: string, override?: string): ClaudeCli {
  const known = cache.get(name)
  if (known) return known
  const remember = (cli: ClaudeCli) => { cache.set(name, cli); return cli }
  if (override) {
    return remember(override.endsWith('.js')
      ? { command: process.execPath, prefixArgs: [override], shell: false }
      : { command: override, prefixArgs: [], shell: false })
  }
  if (process.platform !== 'win32') return remember({ command: name, prefixArgs: [], shell: false })

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const exe = path.join(dir, `${name}.exe`)
    if (fs.existsSync(exe)) return remember({ command: exe, prefixArgs: [], shell: false })
  }
  for (const dir of dirs) {
    const shim = path.join(dir, `${name}.cmd`)
    if (!fs.existsSync(shim)) continue
    const match = fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+?\.(exe|js|cjs|mjs))"/i)
    const target = match ? path.join(dir, match[1]) : ''
    if (target && fs.existsSync(target)) {
      return remember(/\.exe$/i.test(target)
        ? { command: target, prefixArgs: [], shell: false }
        : { command: process.execPath, prefixArgs: [target], shell: false })
    }
    return remember({ command: shim, prefixArgs: [], shell: true })
  }
  return remember({ command: `${name}.cmd`, prefixArgs: [], shell: true })
}

export function resolveClaudeCli(): ClaudeCli {
  return resolveNpmCli('claude', process.env.OASIS_CLAUDE_BIN)
}
