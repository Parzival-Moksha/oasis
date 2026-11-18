import { describe, expect, it } from 'vitest'

import { CliArgError, checkImagePath, checkModel, checkSessionId } from '../cli-args'

const ATTACKS = [
  'opus" & calc & "',
  'opus & calc',
  'opus | whoami',
  'opus; rm -rf /',
  'opus`whoami`',
  '$(whoami)',
  "opus' --dangerously-skip-permissions '",
  'opus\nwhoami',
  '--resume',
  '',
]

describe('what may go on an agent CLI command line', () => {
  it('takes real model ids and aliases', () => {
    for (const m of ['opus', 'sonnet', 'claude-opus-5-5', 'claude-opus-4-6[1m]', 'gpt-5.1-codex', 'openai/gpt-5', 'haiku']) {
      expect(checkModel(m, 'x')).toBe(m)
    }
    expect(checkModel(undefined, 'opus')).toBe('opus')
  })

  it('refuses a model with quotes, &, |, ;, backticks or anything a shell reads', () => {
    for (const bad of ATTACKS.filter(Boolean)) expect(() => checkModel(bad, 'opus'), bad).toThrow(CliArgError)
    expect(() => checkModel(42, 'opus')).toThrow(CliArgError)
  })

  it('takes a session uuid and nothing else', () => {
    expect(checkSessionId('aeceff3e-dda9-4902-bf65-f185d4746e50')).toBe('aeceff3e-dda9-4902-bf65-f185d4746e50')
    expect(checkSessionId(undefined)).toBeUndefined()
    for (const bad of ATTACKS.filter(Boolean)) expect(() => checkSessionId(bad), bad).toThrow(CliArgError)
    expect(() => checkSessionId('aeceff3e-dda9-4902-bf65-f185d4746e50 & calc')).toThrow(CliArgError)
    expect(() => checkSessionId('aeceff3e-dda9-4902-bf65-f185d4746e50"')).toThrow(CliArgError)
  })

  it('takes an existing image file, refuses options and shell characters', () => {
    const exists = () => true
    expect(checkImagePath('C:/Users/l/Pictures/shot 1.png', exists)).toBe('C:/Users/l/Pictures/shot 1.png')
    for (const bad of ['--model', 'a.png & calc', 'a.png | x', 'a.png; x', 'a`x`.png', 'a"b.png', '$(x).png']) {
      expect(() => checkImagePath(bad, exists), bad).toThrow(CliArgError)
    }
    expect(() => checkImagePath('C:/nope.png', () => false)).toThrow(/not found/)
  })
})
