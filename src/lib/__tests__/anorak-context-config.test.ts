import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_MODULE_IDS,
  type CustomContextModule,
  DEFAULT_LOBE_MODULES,
  deriveLegacyContextModules,
  getContextModuleCatalog,
  getDefaultConfigFields,
  mergeContextConfig,
  normalizeContextConfig,
  normalizeCustomModules,
  normalizeLobeModules,
  normalizeTopMissionCount,
} from '../anorak-context-config'

describe('normalizeCustomModules', () => {
  it('sanitizes names, ids, type, and filePath', () => {
    const modules = normalizeCustomModules([
      { name: '## Alpha\n', content: 'hello', enabled: true },
      { name: 'Filey', content: 'ignored', enabled: true, type: 'file', filePath: 'carbondir/openclawuispec.txt' },
    ])

    expect(modules[0].name).toBe('Alpha')
    expect(modules[0].id.startsWith('custom:alpha')).toBe(true)
    expect(modules[0].type).toBe('text')
    expect(modules[1].type).toBe('file')
    expect(modules[1].filePath).toContain('openclawuispec.txt')
  })

  it('caps modules at 20 entries', () => {
    const modules = normalizeCustomModules(Array.from({ length: 30 }, (_, i) => ({
      name: `Module ${i}`,
      content: `content-${i}`,
      enabled: true,
    })))

    expect(modules).toHaveLength(20)
  })

  it('keeps generated ids stable when legacy modules reorder', () => {
    const a = { name: 'Alpha', content: 'same', enabled: true }
    const b = { name: 'Beta', content: 'same', enabled: true }
    const firstPass = normalizeCustomModules([a, b])
    const reordered = normalizeCustomModules([b, a])

    expect(reordered.find(mod => mod.name === 'Alpha')?.id).toBe(firstPass.find(mod => mod.name === 'Alpha')?.id)
    expect(reordered.find(mod => mod.name === 'Beta')?.id).toBe(firstPass.find(mod => mod.name === 'Beta')?.id)
  })
})

describe('normalizeLobeModules + legacy derivation', () => {
  it('migrates legacy toggles and enabled custom modules into curator attachments', () => {
    const customModules: CustomContextModule[] = [
      { id: 'custom:one', name: 'One', content: '1', enabled: true, type: 'text', filePath: '' },
      { id: 'custom:two', name: 'Two', content: '2', enabled: false, type: 'text', filePath: '' },
    ]

    const lobeModules = normalizeLobeModules(undefined, customModules, { rl: true, queued: false, allTodo: true })

    expect(lobeModules.curator).toContain(BUILT_IN_MODULE_IDS.rl)
    expect(lobeModules.curator).toContain(BUILT_IN_MODULE_IDS.allTodo)
    expect(lobeModules.curator).not.toContain(BUILT_IN_MODULE_IDS.queued)
    expect(lobeModules.curator).toContain('custom:one')
    expect(lobeModules.curator).not.toContain('custom:two')
  })

  it('filters unknown ids from explicit lobe module maps', () => {
    const customModules: CustomContextModule[] = [
      { id: 'custom:one', name: 'One', content: '1', enabled: true, type: 'text', filePath: '' },
    ]

    const lobeModules = normalizeLobeModules({
      curator: [BUILT_IN_MODULE_IDS.rl, 'bogus:id', 'custom:one'],
      coder: ['bogus:id'],
    }, customModules)

    expect(lobeModules.curator).toEqual([BUILT_IN_MODULE_IDS.rl, 'custom:one'])
    expect(lobeModules.coder).toEqual([])
  })

  it('derives legacy booleans from curator attachments', () => {
    const legacy = deriveLegacyContextModules({
      ...DEFAULT_LOBE_MODULES,
      curator: [BUILT_IN_MODULE_IDS.queued, BUILT_IN_MODULE_IDS.allTodo],
    })

    expect(legacy).toEqual({ rl: false, queued: true, allTodo: true })
  })
})

describe('mergeContextConfig', () => {
  it('deep merges model overrides while preserving module state', () => {
    const base = {
      models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
      reviewerThreshold: 90,
      batchSize: 1,
      recapLength: 100,
      autoCurate: false,
      autoCode: false,
      ...getDefaultConfigFields(),
    }

    const merged = mergeContextConfig(base, {
      models: { reviewer: 'haiku' },
      lobeModules: {
        ...base.lobeModules,
        curator: [BUILT_IN_MODULE_IDS.rl, BUILT_IN_MODULE_IDS.topAnorak],
      },
    })

    expect(merged.models.curator).toBe('sonnet')
    expect(merged.models.reviewer).toBe('haiku')
    expect(merged.contextModules.rl).toBe(true)
    expect(merged.contextModules.queued).toBe(false)
  })

  it('re-normalizes current lobe modules when custom modules change without an explicit lobeModules patch', () => {
    const base = {
      models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
      reviewerThreshold: 90,
      batchSize: 1,
      recapLength: 100,
      autoCurate: false,
      autoCode: false,
      ...getDefaultConfigFields(),
      customModules: [
        { id: 'custom:one', name: 'One', content: '1', enabled: true, type: 'text' as const, filePath: '' },
      ],
      lobeModules: {
        ...getDefaultConfigFields().lobeModules,
        curator: [...getDefaultConfigFields().lobeModules.curator, 'custom:one'],
      },
    }

    const merged = mergeContextConfig(base, {
      customModules: [
        { id: 'custom:one', name: 'One', content: '1', enabled: false, type: 'text' as const, filePath: '' },
      ],
    })

    expect(merged.lobeModules.curator).not.toContain('custom:one')
  })
})

describe('normalizeContextConfig', () => {
  it('hydrates legacy saved config into canonical lobe modules', () => {
    const defaults = {
      models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
      reviewerThreshold: 90,
      batchSize: 1,
      recapLength: 100,
      autoCurate: false,
      autoCode: false,
      ...getDefaultConfigFields(),
    }

    const hydrated = normalizeContextConfig({
      autoCurate: true,
      contextModules: { rl: false, queued: true, allTodo: true },
      customModules: [{ name: 'Legacy text', content: 'hi', enabled: true }],
    }, defaults)

    expect(hydrated.autoCurate).toBe(true)
    expect(hydrated.lobeModules.curator).toContain(BUILT_IN_MODULE_IDS.queued)
    expect(hydrated.lobeModules.curator).toContain(BUILT_IN_MODULE_IDS.allTodo)
    expect(hydrated.lobeModules.curator).not.toContain(BUILT_IN_MODULE_IDS.rl)
    expect(hydrated.customModules[0].id.startsWith('custom:legacy-text')).toBe(true)
  })

  it('returns defaults when saved config is null', () => {
    const defaults = {
      models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
      reviewerThreshold: 90,
      batchSize: 1,
      recapLength: 100,
      autoCurate: false,
      autoCode: false,
      ...getDefaultConfigFields(),
    }

    expect(normalizeContextConfig(null, defaults)).toEqual(defaults)
  })
})

describe('catalog helpers', () => {
  it('includes builtin and custom entries in the module catalog', () => {
    const catalog = getContextModuleCatalog([
      { id: 'custom:one', name: 'One', content: '1', enabled: true, type: 'text', filePath: '' },
    ])

    expect(catalog.some(entry => entry.id === BUILT_IN_MODULE_IDS.rl)).toBe(true)
    expect(catalog.some(entry => entry.id === 'custom:one')).toBe(true)
  })

  it('default config fields include canonical CEHQ defaults', () => {
    const defaults = getDefaultConfigFields()
    expect(defaults.contextModules).toEqual({ rl: true, queued: true, allTodo: false })
    expect(defaults.lobeModules.curator).toEqual([BUILT_IN_MODULE_IDS.rl, BUILT_IN_MODULE_IDS.queued])
  })
})

describe('normalizeTopMissionCount', () => {
  it('clamps and rounds values into 1-10', () => {
    expect(normalizeTopMissionCount(0)).toBe(1)
    expect(normalizeTopMissionCount(11)).toBe(10)
    expect(normalizeTopMissionCount(1.7)).toBe(2)
    expect(normalizeTopMissionCount('5')).toBe(5)
  })

  it('falls back to the default on invalid input', () => {
    expect(normalizeTopMissionCount(Number.NaN)).toBe(3)
    expect(normalizeTopMissionCount(undefined)).toBe(3)
  })
})
