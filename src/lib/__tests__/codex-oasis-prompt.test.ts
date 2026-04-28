import { describe, expect, it } from 'vitest'

import {
  CODEX_IN_OASIS_PROMPT,
  buildCodexOasisPrompt,
  formatCodexOasisContext,
  sanitizeCodexOasisContext,
} from '@/lib/codex-oasis-prompt'

describe('codex-oasis-prompt', () => {
  it('wraps user prompts with the durable Codex-in-Oasis identity', () => {
    const prompt = buildCodexOasisPrompt('inspect the world')

    expect(prompt).toContain('<oasis-codex-context>')
    expect(prompt).toContain(CODEX_IN_OASIS_PROMPT)
    expect(prompt).toContain('Your first name is Codex')
    expect(prompt).toContain('User request:\ninspect the world')
  })

  it('adds compact Oasis context when provided', () => {
    const prompt = buildCodexOasisPrompt('take a screenshot', {
      surface: 'agent-window-3d',
      activeWorldId: 'world-1',
      linkedAvatarId: 'agent-avatar-codex',
    })

    expect(prompt).toContain('Current Oasis context:')
    expect(prompt).toContain('"surface": "agent-window-3d"')
    expect(prompt).toContain('"activeWorldId": "world-1"')
    expect(prompt).toContain('"linkedAvatarId": "agent-avatar-codex"')
  })

  it('drops empty values and truncates long strings', () => {
    const clean = sanitizeCodexOasisContext({
      empty: '',
      missing: undefined,
      long: 'x'.repeat(400),
    })

    expect(clean.empty).toBeUndefined()
    expect(clean.missing).toBeUndefined()
    expect(String(clean.long)).toHaveLength(240)
    expect(String(clean.long)).toMatch(/\.\.\.$/)
  })

  it('omits the current context section when no context survives sanitizing', () => {
    expect(formatCodexOasisContext({ empty: '', missing: undefined })).toBe('')
  })
})
