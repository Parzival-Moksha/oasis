// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO CONFIG — DEEP MERGE unit tests
// The REAL loadConfig in AnorakProPanel.tsx does deep merge on nested
// objects (models, contextModules). The original test file only tested
// shallow spread. This file tests the actual deep-merge behavior.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// Faithful mirror of the REAL loadConfig from AnorakProPanel.tsx
// (includes deep merge for nested objects — models + contextModules)
// ═══════════════════════════════════════════════════════════════════════════

interface AnorakProConfig {
  models: { curator: string; coder: string; reviewer: string; tester: string }
  reviewerThreshold: number
  batchSize: number
  recapLength: number
  autoCurate: boolean
  autoCode: boolean
  contextModules: { rl: boolean; queued: boolean; allTodo: boolean }
}

const DEFAULT_CONFIG: AnorakProConfig = {
  models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
  reviewerThreshold: 90,
  batchSize: 1,
  recapLength: 100,
  autoCurate: false,
  autoCode: false,
  contextModules: { rl: true, queued: true, allTodo: false },
}

const CONFIG_KEY = 'oasis-anorak-pro-config'

// Mirrors the REAL loadConfig with deep merge (lines 53-65 of AnorakProPanel.tsx)
function loadConfigDeep(storage: Record<string, string | null>): AnorakProConfig {
  try {
    const saved = JSON.parse(storage[CONFIG_KEY] || 'null')
    if (!saved) return DEFAULT_CONFIG
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      models: { ...DEFAULT_CONFIG.models, ...saved.models },
      contextModules: { ...DEFAULT_CONFIG.contextModules, ...saved.contextModules },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEEP MERGE: models — partial saves survive
// ═══════════════════════════════════════════════════════════════════════════

describe('loadConfig deep merge — models', () => {
  it('preserves default models when saved has no models key', () => {
    const saved = JSON.stringify({ batchSize: 5 })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.models).toEqual(DEFAULT_CONFIG.models)
  })

  it('preserves unset model slots when only one model is saved', () => {
    const saved = JSON.stringify({ models: { coder: 'haiku' } })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.models.coder).toBe('haiku')
    expect(result.models.curator).toBe('sonnet')
    expect(result.models.reviewer).toBe('sonnet')
    expect(result.models.tester).toBe('sonnet')
  })

  it('deep merges two model overrides while keeping the others', () => {
    const saved = JSON.stringify({ models: { curator: 'opus', tester: 'haiku' } })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.models.curator).toBe('opus')
    expect(result.models.coder).toBe('opus') // default
    expect(result.models.reviewer).toBe('sonnet') // default
    expect(result.models.tester).toBe('haiku')
  })

  it('overrides all model slots when all are saved', () => {
    const saved = JSON.stringify({
      models: { curator: 'haiku', coder: 'haiku', reviewer: 'haiku', tester: 'haiku' },
    })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.models).toEqual({ curator: 'haiku', coder: 'haiku', reviewer: 'haiku', tester: 'haiku' })
  })

  it('handles saved models as empty object — all defaults preserved', () => {
    const saved = JSON.stringify({ models: {} })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.models).toEqual(DEFAULT_CONFIG.models)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DEEP MERGE: contextModules — partial saves survive
// ═══════════════════════════════════════════════════════════════════════════

describe('loadConfig deep merge — contextModules', () => {
  it('preserves default contextModules when saved has no contextModules key', () => {
    const saved = JSON.stringify({ autoCurate: true })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.contextModules).toEqual(DEFAULT_CONFIG.contextModules)
  })

  it('preserves unset contextModule flags when only one is saved', () => {
    const saved = JSON.stringify({ contextModules: { allTodo: true } })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.contextModules.allTodo).toBe(true)
    expect(result.contextModules.rl).toBe(true)     // default
    expect(result.contextModules.queued).toBe(true)  // default
  })

  it('deep merges two contextModule overrides', () => {
    const saved = JSON.stringify({ contextModules: { rl: false, allTodo: true } })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.contextModules.rl).toBe(false)
    expect(result.contextModules.queued).toBe(true)    // default
    expect(result.contextModules.allTodo).toBe(true)
  })

  it('handles saved contextModules as empty object — all defaults preserved', () => {
    const saved = JSON.stringify({ contextModules: {} })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(result.contextModules).toEqual(DEFAULT_CONFIG.contextModules)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DEEP MERGE: combined nested + top-level partial saves
// ═══════════════════════════════════════════════════════════════════════════

describe('loadConfig deep merge — combined partial saves', () => {
  it('merges top-level + partial models + partial contextModules simultaneously', () => {
    const saved = JSON.stringify({
      batchSize: 3,
      recapLength: 50,
      models: { reviewer: 'opus' },
      contextModules: { queued: false },
    })
    const result = loadConfigDeep({ [CONFIG_KEY]: saved })
    // Top-level overrides
    expect(result.batchSize).toBe(3)
    expect(result.recapLength).toBe(50)
    // Defaults preserved
    expect(result.reviewerThreshold).toBe(90)
    expect(result.autoCurate).toBe(false)
    expect(result.autoCode).toBe(false)
    // Deep-merged models
    expect(result.models.reviewer).toBe('opus')
    expect(result.models.curator).toBe('sonnet')
    expect(result.models.coder).toBe('opus')
    expect(result.models.tester).toBe('sonnet')
    // Deep-merged contextModules
    expect(result.contextModules.queued).toBe(false)
    expect(result.contextModules.rl).toBe(true)
    expect(result.contextModules.allTodo).toBe(false)
  })

  it('null storage returns exact DEFAULT_CONFIG', () => {
    const result = loadConfigDeep({ [CONFIG_KEY]: null })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('invalid JSON returns exact DEFAULT_CONFIG', () => {
    const result = loadConfigDeep({ [CONFIG_KEY]: '{broken' })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('"null" string returns exact DEFAULT_CONFIG', () => {
    const result = loadConfigDeep({ [CONFIG_KEY]: 'null' })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('empty object returns exact DEFAULT_CONFIG (all nested defaults survive)', () => {
    const result = loadConfigDeep({ [CONFIG_KEY]: '{}' })
    // The deep merge ensures nested objects are preserved even with empty saved
    expect(result).toEqual(DEFAULT_CONFIG)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SHALLOW vs DEEP: prove the bug that deep merge prevents
// ═══════════════════════════════════════════════════════════════════════════

describe('shallow merge would lose nested defaults (regression guard)', () => {
  // A shallow-only merge ({ ...DEFAULT, ...saved }) would REPLACE the entire
  // models object if saved.models exists, losing unset slots.
  // The deep merge prevents this.

  function loadConfigShallow(storage: Record<string, string | null>): AnorakProConfig {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(storage[CONFIG_KEY] || 'null') }
    } catch {
      return DEFAULT_CONFIG
    }
  }

  it('shallow merge LOSES unset model slots (demonstrating the bug)', () => {
    const saved = JSON.stringify({ models: { coder: 'haiku' } })
    const shallow = loadConfigShallow({ [CONFIG_KEY]: saved })
    // Shallow merge replaces the whole models object
    expect(shallow.models.curator).toBeUndefined()  // BUG: lost!
    expect(shallow.models.reviewer).toBeUndefined() // BUG: lost!
    expect(shallow.models.tester).toBeUndefined()   // BUG: lost!
    expect(shallow.models.coder).toBe('haiku')      // only the saved one survives
  })

  it('deep merge PRESERVES unset model slots (the fix)', () => {
    const saved = JSON.stringify({ models: { coder: 'haiku' } })
    const deep = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(deep.models.curator).toBe('sonnet')   // preserved!
    expect(deep.models.reviewer).toBe('sonnet')  // preserved!
    expect(deep.models.tester).toBe('sonnet')    // preserved!
    expect(deep.models.coder).toBe('haiku')
  })

  it('shallow merge LOSES unset contextModule flags', () => {
    const saved = JSON.stringify({ contextModules: { allTodo: true } })
    const shallow = loadConfigShallow({ [CONFIG_KEY]: saved })
    expect(shallow.contextModules.rl).toBeUndefined()     // BUG: lost!
    expect(shallow.contextModules.queued).toBeUndefined()  // BUG: lost!
  })

  it('deep merge PRESERVES unset contextModule flags', () => {
    const saved = JSON.stringify({ contextModules: { allTodo: true } })
    const deep = loadConfigDeep({ [CONFIG_KEY]: saved })
    expect(deep.contextModules.rl).toBe(true)     // preserved!
    expect(deep.contextModules.queued).toBe(true)  // preserved!
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE VERIFICATION: loadConfig actually does deep merge
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel loadConfig source — deep merge verification', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
  const content = fs.readFileSync(panelPath, 'utf-8')

  it('deep merges models: { ...DEFAULT_CONFIG.models, ...saved.models }', () => {
    expect(content).toContain('models: { ...DEFAULT_CONFIG.models, ...saved.models }')
  })

  it('deep merges contextModules: { ...DEFAULT_CONFIG.contextModules, ...saved.contextModules }', () => {
    expect(content).toContain('contextModules: { ...DEFAULT_CONFIG.contextModules, ...saved.contextModules }')
  })

  it('handles null saved by returning DEFAULT_CONFIG early', () => {
    expect(content).toContain('if (!saved) return DEFAULT_CONFIG')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR-LOGS ROUTE — exports GET (supplementary check)
// ═══════════════════════════════════════════════════════════════════════════

describe('curator-logs route exports', () => {
  it('route module can be required and exports GET', () => {
    const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/curator-logs/route.ts')
    const content = fs.readFileSync(routePath, 'utf-8')
    // Verify the export signature
    expect(content).toMatch(/^export async function GET/m)
  })

  it('does not export POST (read-only endpoint)', () => {
    const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/curator-logs/route.ts')
    const content = fs.readFileSync(routePath, 'utf-8')
    expect(content).not.toContain('export async function POST')
    expect(content).not.toContain('export async function PUT')
    expect(content).not.toContain('export async function DELETE')
  })
})
