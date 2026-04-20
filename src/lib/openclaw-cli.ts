import 'server-only'

import { existsSync } from 'fs'
import path from 'path'
import { spawn } from 'child_process'

export interface OpenclawCliResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

function resolveOpenclawCommand(): string {
  const explicit = process.env.OPENCLAW_BIN?.trim()
  if (explicit) return explicit

  if (process.platform !== 'win32') {
    return 'openclaw'
  }

  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'openclaw.cmd') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'openclaw.cmd') : '',
    'openclaw.cmd',
    'openclaw',
  ].filter(Boolean)

  const existing = candidates.find(candidate => {
    if (!candidate.includes('\\') && !candidate.includes('/')) return false
    return existsSync(candidate)
  })

  return existing || candidates[0] || 'openclaw'
}

export async function runOpenclawCli(args: string[], timeoutMs = 12000): Promise<OpenclawCliResult> {
  return await new Promise<OpenclawCliResult>((resolve) => {
    const command = resolveOpenclawCommand()
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Timed out after ${timeoutMs}ms.`,
      })
    }, timeoutMs)

    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
      })
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => {
        stderr += chunk
      })
    }

    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
      })
    })

    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      })
    })
  })
}
