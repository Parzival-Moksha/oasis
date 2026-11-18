import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { resolveNpmCli } from '../claude-bin'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-npm-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe.runIf(process.platform === 'win32')('an npm CLI starts without a shell', () => {
  it('reads the real program from the .cmd shim (codex: node + its .js)', () => {
    const target = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '')
    const bs = String.fromCharCode(92)
    const shim = `@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%${bs}node_modules${bs}@openai${bs}codex${bs}bin${bs}codex.js" %*\r\n`
    fs.writeFileSync(path.join(dir, 'fakecodex.cmd'), shim)
    const before = process.env.PATH
    process.env.PATH = `${dir}${path.delimiter}${before}`
    try {
      const cli = resolveNpmCli('fakecodex')
      expect(cli.shell).toBe(false)
      expect(cli.command).toBe(process.execPath)
      expect(cli.prefixArgs).toEqual([target])
    } finally {
      process.env.PATH = before
    }
  })

  it('finds the real claude and codex on this machine without a shell', () => {
    for (const name of ['claude', 'codex']) {
      const cli = resolveNpmCli(name)
      if (cli.command.endsWith('.cmd')) continue // not installed here
      expect(cli.shell, name).toBe(false)
    }
  })
})
