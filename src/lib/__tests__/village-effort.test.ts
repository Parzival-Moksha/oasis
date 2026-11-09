import { describe, expect, it } from 'vitest'
import { effortLevelsFor } from '../village/village-effort'

const models = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as const },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as const },
  { value: 'claude-sonnet-4-6', resolvedModel: 'claude-sonnet-4-6', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] as const },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001' },
].map(m => ({ ...m, supportedEffortLevels: m.supportedEffortLevels ? [...m.supportedEffortLevels] : undefined }))

describe('effortLevelsFor', () => {
  it("offers the levels the agent's model takes", () => {
    expect(effortLevelsFor({ model: 'sonnet', models })).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(effortLevelsFor({ model: 'claude-sonnet-4-6', models })).toEqual(['low', 'medium', 'high', 'max'])
  })

  it('matches by the resolved model when the agent runs the default (or a 1M-context id)', () => {
    expect(effortLevelsFor({ model: null, resolvedModel: 'claude-sonnet-4-6[1m]', models })).toEqual(['low', 'medium', 'high', 'max'])
    expect(effortLevelsFor({ model: null, resolvedModel: null, models })).toHaveLength(5) // the "default" row
  })

  it('offers nothing for a model without effort, everything when the model list is unknown', () => {
    expect(effortLevelsFor({ model: 'claude-haiku-4-5-20251001', models })).toEqual([])
    expect(effortLevelsFor({ model: 'opus', models: null })).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    // An older engine lists models without effort fields.
    expect(effortLevelsFor({ model: 'opus', models: [{ value: 'opus', resolvedModel: 'claude-opus-5-5' }] })).toHaveLength(5)
  })
})
