// @vitest-environment node
// What the keychain writes into a .env line must come back exactly as pasted when Next itself reads the
// file (dotenv + dotenv-expand, which expands $NAME even inside quotes).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { formatEnvValue, setEnvValue } from '../keychain'

const requireFromNext = createRequire(require.resolve('next/package.json'))
const { loadEnvConfig } = requireFromNext('@next/env') as {
  loadEnvConfig: (dir: string, dev?: boolean, log?: { info: () => void; error: () => void }, forceReload?: boolean) => { combinedEnv: Record<string, string | undefined> }
}

const NAME = 'KEYCHAIN_ROUNDTRIP_TEST_KEY'

function readBack(fileText: string): string | undefined {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'keychain-roundtrip-'))
  try {
    writeFileSync(path.join(dir, '.env'), fileText)
    delete process.env[NAME]
    return loadEnvConfig(dir, true, { info() {}, error() {} }, true).combinedEnv[NAME]
  } finally {
    delete process.env[NAME]
    rmSync(dir, { recursive: true, force: true })
  }
}

const VALUES = [
  'sk-proj-abc_123.XYZ',
  'sk-ab$cdef',
  'x${HOME}y',
  '$$double$$',
  'ends with $',
  'has space # and hash',
  "it's quoted",
  'back\\slash',
  'trailing\\',
  'tab\there',
  'unicode   line sep   para',
  'equals==and:colons@at~tilde',
  '"double" only',
  'é ü ß 日本',
]

describe('a stored value reads back the same through Next', () => {
  for (const value of VALUES) {
    it(JSON.stringify(value), () => {
      const formatted = formatEnvValue(value)
      expect(formatted, 'refused').not.toBeNull()
      expect(readBack(setEnvValue('OTHER=1\n', NAME, formatted as string))).toBe(value)
    })
  }

  it('replacing keeps the last assignment right too (Next takes the last one)', () => {
    const text = setEnvValue(`${NAME}=old\nA=1\n${NAME}=older\n`, NAME, formatEnvValue('new$value') as string)
    expect(readBack(text)).toBe('new$value')
  })
})
