import { describe, expect, it } from 'vitest'

import {
  ALLOWED_CRAFT_MODELS,
  CRAFT_MODEL_OPTIONS,
  DEFAULT_CRAFT_CHOICE,
  DEFAULT_CRAFT_MODEL,
  claudeCodeCraftModel,
  normalizeCraftChoice,
  normalizeCraftModelId,
} from '../craft-models'
import { claudeCodeCraftArgs, craftTextFromLine } from '../craft-claude-code'

describe('craft models', () => {
  it('starts with Claude Code: Opus 5.5, then Fable 5.2', () => {
    expect(CRAFT_MODEL_OPTIONS.slice(0, 2).map(option => option.id)).toEqual(['cc-opus-5-5', 'cc-fable-5-2'])
    expect(DEFAULT_CRAFT_CHOICE).toBe('cc-opus-5-5')
    expect(claudeCodeCraftModel('cc-opus-5-5')).toBe('claude-opus-5-5')
    expect(claudeCodeCraftModel('cc-fable-5-2')).toBe('claude-fable-5-2')
    expect(claudeCodeCraftModel('google/gemini-3.8-flash')).toBeNull()
  })

  it('the picker keeps any listed model and turns the old Claude Code ids into Opus 5.5', () => {
    expect(normalizeCraftChoice('cc-fable-5-2')).toBe('cc-fable-5-2')
    expect(normalizeCraftChoice('openai/gpt-5.4-mini')).toBe('openai/gpt-5.4-mini')
    expect(normalizeCraftChoice('cc-sonnet')).toBe('cc-opus-5-5')
    expect(claudeCodeCraftModel('cc-opus')).toBe('claude-opus-5-5')
    expect(normalizeCraftChoice('z-ai/glm-5')).toBe(DEFAULT_CRAFT_CHOICE)
    expect(normalizeCraftChoice(null)).toBe(DEFAULT_CRAFT_CHOICE)
  })

  it('the OpenRouter routes only ever get an OpenRouter model', () => {
    expect(normalizeCraftModelId('google/gemini-3.8-flash')).toBe('google/gemini-3.8-flash')
    expect(normalizeCraftModelId('openai/gpt-5.4-mini')).toBe('openai/gpt-5.4-mini')
    for (const value of ['cc-opus-5-5', 'cc-sonnet', 'sonnet', 'google/gemini-3.1-pro-preview', 'z-ai/glm-5', 'not-a-real-model', '']) {
      expect(normalizeCraftModelId(value)).toBe(DEFAULT_CRAFT_MODEL)
    }
    expect(ALLOWED_CRAFT_MODELS).toContain(DEFAULT_CRAFT_MODEL)
    expect(ALLOWED_CRAFT_MODELS.some(id => id.startsWith('cc-'))).toBe(false)
  })
})

describe('crafting through Claude Code', () => {
  it('runs the CLI with no tools, no MCP, no settings, no saved session, the craft prompt as the system prompt', () => {
    const args = claudeCodeCraftArgs('claude-opus-5-5')
    expect(args).toEqual(expect.arrayContaining(['-p', '--include-partial-messages', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']))
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args[args.indexOf('--system-prompt') + 1]).toMatch(/JSON/)
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('reads text deltas, the final result and errors from stream-json', () => {
    expect(craftTextFromLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"na' } } }))).toEqual({ text: '{"na' })
    expect(craftTextFromLine(JSON.stringify({ type: 'result', is_error: false, result: '{"name":"x"}' }))).toEqual({ text: '', final: '{"name":"x"}' })
    expect(craftTextFromLine(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' })).error).toBe('Not logged in')
    expect(craftTextFromLine('not json')).toEqual({ text: '' })
  })
})
