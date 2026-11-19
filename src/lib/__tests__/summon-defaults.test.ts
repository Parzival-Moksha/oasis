import path from 'path'
import { describe, expect, it } from 'vitest'

import { hermesInstallHome, hermesModelOf, oasisWorkspace, pickDefaultFolder } from '../village/summon-defaults'

describe('pickDefaultFolder', () => {
  it('keeps the folder you last summoned in', () => {
    expect(pickDefaultFolder('C:\\work', ['C:\\other'], 'C:\\Users\\a\\Oasis')).toEqual({ path: 'C:\\work', source: 'last', create: false })
  })
  it('falls back to your newest session, then the Oasis folder (made on Create)', () => {
    expect(pickDefaultFolder('  ', ['', 'C:\\other'], 'C:\\Users\\a\\Oasis')).toEqual({ path: 'C:\\other', source: 'session', create: false })
    expect(pickDefaultFolder(null, [], 'C:\\Users\\a\\Oasis')).toEqual({ path: 'C:\\Users\\a\\Oasis', source: 'workspace', create: true })
  })
})

describe('homes', () => {
  it('puts the Oasis folder in the home folder', () => {
    expect(oasisWorkspace('/home/a', path.posix)).toBe('/home/a/Oasis')
  })
  it('finds the installer Hermes home per platform', () => {
    expect(hermesInstallHome('win32', 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Local', path.win32)).toBe('C:\\Users\\a\\AppData\\Local\\hermes')
    expect(hermesInstallHome('win32', 'C:\\Users\\a', undefined, path.win32)).toBe('C:\\Users\\a\\AppData\\Local\\hermes')
    expect(hermesInstallHome('linux', '/home/a', undefined, path.posix)).toBe('/home/a/.hermes')
  })
})

describe('hermesModelOf', () => {
  it('reads model.default', () => {
    expect(hermesModelOf('x: 1\nmodel:\n  default: gpt-6.1-sol\n  provider: openai\nother:\n  default: no\n')).toBe('gpt-6.1-sol')
    expect(hermesModelOf("model:\n  default: 'qwen3:8b'\n")).toBe('qwen3:8b')
  })
  it('reads an inline model and gives empty when none', () => {
    expect(hermesModelOf('model: hermes-4\n')).toBe('hermes-4')
    expect(hermesModelOf("model:\n  provider: x\nfoo: bar\n  default: nope\n")).toBe('')
    expect(hermesModelOf('')).toBe('')
  })
})
