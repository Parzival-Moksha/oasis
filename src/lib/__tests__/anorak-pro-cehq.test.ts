// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO CEHQ — Unit tests for lobeprompt route, DharmaTags,
// custom modules cap, LobeEditor AbortController + try/catch
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// Mirror pure-logic extracts from AnorakProPanel / lobeprompt route
// ═══════════════════════════════════════════════════════════════════════════

const VALID_LOBES = ['curator', 'coder', 'reviewer', 'tester', 'gamer', 'merlin'] as const

function isValidLobe(lobe: string): boolean {
  return VALID_LOBES.includes(lobe as typeof VALID_LOBES[number])
}

const DHARMA_ABBR: Record<string, { label: string; color: string }> = {
  view: { label: 'VW', color: '#60a5fa' },
  intention: { label: 'IN', color: '#f59e0b' },
  speech: { label: 'SP', color: '#a78bfa' },
  action: { label: 'AC', color: '#ef4444' },
  livelihood: { label: 'LH', color: '#22c55e' },
  effort: { label: 'EF', color: '#f97316' },
  mindfulness: { label: 'MF', color: '#14b8a6' },
  concentration: { label: 'CN', color: '#ec4899' },
}

function dharmaToTags(dharma: string | null): Array<{ label: string; color: string; path: string }> | null {
  if (!dharma) return null
  const paths = dharma.split(',').map(s => s.trim()).filter(Boolean)
  return paths.map(p => {
    const d = DHARMA_ABBR[p]
    return d ? { label: d.label, color: d.color, path: p } : null
  }).filter(Boolean) as Array<{ label: string; color: string; path: string }>
}

interface CustomContextModule {
  name: string
  content: string
  enabled: boolean
}

interface AnorakProConfig {
  models: { curator: string; coder: string; reviewer: string; tester: string }
  reviewerThreshold: number
  batchSize: number
  recapLength: number
  autoCurate: boolean
  autoCode: boolean
  contextModules: { rl: boolean; queued: boolean; allTodo: boolean }
  customModules: CustomContextModule[]
}

const DEFAULT_CONFIG: AnorakProConfig = {
  models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
  reviewerThreshold: 90,
  batchSize: 1,
  recapLength: 100,
  autoCurate: false,
  autoCode: false,
  contextModules: { rl: true, queued: true, allTodo: false },
  customModules: [],
}

const CONFIG_KEY = 'oasis-anorak-pro-config'

function loadConfig(storage: Record<string, string | null>): AnorakProConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(storage[CONFIG_KEY] || 'null') }
  } catch {
    return DEFAULT_CONFIG
  }
}

function saveConfig(c: AnorakProConfig): string {
  return JSON.stringify(c)
}

// ═══════════════════════════════════════════════════════════════════════════
// LOBEPROMPT ROUTE — whitelist validation
// ═══════════════════════════════════════════════════════════════════════════

describe('lobeprompt route — lobe whitelist', () => {
  it('accepts curator', () => expect(isValidLobe('curator')).toBe(true))
  it('accepts coder', () => expect(isValidLobe('coder')).toBe(true))
  it('accepts reviewer', () => expect(isValidLobe('reviewer')).toBe(true))
  it('accepts tester', () => expect(isValidLobe('tester')).toBe(true))
  it('accepts gamer', () => expect(isValidLobe('gamer')).toBe(true))
  it('accepts merlin', () => expect(isValidLobe('merlin')).toBe(true))

  it('rejects "hacker"', () => expect(isValidLobe('hacker')).toBe(false))
  it('rejects "admin"', () => expect(isValidLobe('admin')).toBe(false))
  it('rejects empty string', () => expect(isValidLobe('')).toBe(false))
  it('rejects "Curator" (case-sensitive)', () => expect(isValidLobe('Curator')).toBe(false))
  it('rejects path-traversal attempt', () => expect(isValidLobe('../../../etc/passwd')).toBe(false))
  it('rejects "coach" (valid Parzival mode, not a lobe)', () => expect(isValidLobe('coach')).toBe(false))
})

// ═══════════════════════════════════════════════════════════════════════════
// LOBEPROMPT ROUTE — source verification (GET/PUT shape, content limits)
// ═══════════════════════════════════════════════════════════════════════════

describe('lobeprompt route — source verification', () => {
  const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/lobeprompt/route.ts')

  it('route file exists', () => {
    expect(fs.existsSync(routePath)).toBe(true)
  })

  it('exports GET handler', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('export async function GET')
  })

  it('exports PUT handler', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('export async function PUT')
  })

  it('GET returns { lobe, content, charCount }', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('lobe, content, charCount')
  })

  it('PUT returns { lobe, charCount, saved: true }', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('lobe, charCount: content.length, saved: true')
  })

  it('validates VALID_LOBES whitelist', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("VALID_LOBES = ['curator', 'coder', 'reviewer', 'tester', 'gamer', 'merlin']")
  })

  it('enforces min content length of 10', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('content.length < 10')
  })

  it('enforces max content length of 50000', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('content.length > 50000')
  })

  it('returns 400 on invalid lobe', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('status: 400')
  })

  it('returns 404 on missing agent .md', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('status: 404')
  })

  it('returns 500 on write failure', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('status: 500')
  })

  it('reads from .claude/agents/ directory', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("'.claude', 'agents'")
  })

  it('PUT validates JSON body', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('Invalid JSON')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DHARMATAGS — abbreviation mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('DharmaTags logic', () => {
  it('returns null for null dharma', () => {
    expect(dharmaToTags(null)).toBeNull()
  })

  it('returns null for empty string (falsy)', () => {
    // empty string is falsy → !dharma → return null
    const result = dharmaToTags('')
    expect(result).toBeNull()
  })

  it('maps "view" to VW', () => {
    const tags = dharmaToTags('view')!
    expect(tags).toHaveLength(1)
    expect(tags[0].label).toBe('VW')
  })

  it('maps "intention" to IN', () => {
    const tags = dharmaToTags('intention')!
    expect(tags[0].label).toBe('IN')
  })

  it('maps "speech" to SP', () => {
    const tags = dharmaToTags('speech')!
    expect(tags[0].label).toBe('SP')
  })

  it('maps "action" to AC', () => {
    const tags = dharmaToTags('action')!
    expect(tags[0].label).toBe('AC')
  })

  it('maps "livelihood" to LH', () => {
    const tags = dharmaToTags('livelihood')!
    expect(tags[0].label).toBe('LH')
  })

  it('maps "effort" to EF', () => {
    const tags = dharmaToTags('effort')!
    expect(tags[0].label).toBe('EF')
  })

  it('maps "mindfulness" to MF', () => {
    const tags = dharmaToTags('mindfulness')!
    expect(tags[0].label).toBe('MF')
  })

  it('maps "concentration" to CN', () => {
    const tags = dharmaToTags('concentration')!
    expect(tags[0].label).toBe('CN')
  })

  it('handles CSV with multiple paths', () => {
    const tags = dharmaToTags('view, action, effort')!
    expect(tags).toHaveLength(3)
    expect(tags.map(t => t.label)).toEqual(['VW', 'AC', 'EF'])
  })

  it('ignores unknown paths in CSV', () => {
    const tags = dharmaToTags('view, bogus, action')!
    expect(tags).toHaveLength(2)
    expect(tags.map(t => t.label)).toEqual(['VW', 'AC'])
  })

  it('trims whitespace in CSV entries', () => {
    const tags = dharmaToTags('  view  ,  effort  ')!
    expect(tags).toHaveLength(2)
  })

  it('all 8 Eightfold Path entries are covered', () => {
    expect(Object.keys(DHARMA_ABBR)).toHaveLength(8)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DHARMATAGS — source verification in AnorakProPanel
// ═══════════════════════════════════════════════════════════════════════════

describe('DharmaTags source', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')

  it('DharmaTags component exists', () => {
    const src = fs.readFileSync(panelPath, 'utf-8')
    expect(src).toContain('function DharmaTags')
  })

  it('handles null dharma with early return', () => {
    const src = fs.readFileSync(panelPath, 'utf-8')
    expect(src).toContain('if (!dharma) return null')
  })

  it('DHARMA_ABBR has all 8 paths', () => {
    const src = fs.readFileSync(panelPath, 'utf-8')
    for (const p of ['view', 'intention', 'speech', 'action', 'livelihood', 'effort', 'mindfulness', 'concentration']) {
      expect(src).toContain(`${p}: { label:`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM MODULES — 20 cap enforced
// ═══════════════════════════════════════════════════════════════════════════

describe('Custom modules — 20 cap', () => {
  it('DEFAULT_CONFIG has empty customModules', () => {
    expect(DEFAULT_CONFIG.customModules).toEqual([])
  })

  it('adding module up to cap 20 is allowed (logic mirror)', () => {
    let modules: CustomContextModule[] = []
    for (let i = 0; i < 20; i++) {
      if (modules.length < 20) {
        modules = [...modules, { name: `Module ${i + 1}`, content: '', enabled: true }]
      }
    }
    expect(modules).toHaveLength(20)
  })

  it('cap blocks 21st module', () => {
    let modules: CustomContextModule[] = Array.from({ length: 20 }, (_, i) => ({
      name: `Module ${i + 1}`, content: '', enabled: true,
    }))
    // Mirror the panel logic: if (modules.length >= 20) return
    if (modules.length < 20) {
      modules = [...modules, { name: 'Over', content: '', enabled: true }]
    }
    expect(modules).toHaveLength(20)
  })

  it('source enforces >= 20 check in Add button', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx'), 'utf-8'
    )
    expect(src).toContain("customModules?.length ?? 0) >= 20")
  })

  it('source disables Add button at cap', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx'), 'utf-8'
    )
    expect(src).toContain("disabled={(config.customModules?.length ?? 0) >= 20}")
  })

  it('textarea has maxLength={400000}', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx'), 'utf-8'
    )
    expect(src).toContain('maxLength={400000}')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG ROUND-TRIP with customModules
// ═══════════════════════════════════════════════════════════════════════════

describe('Config round-trip with customModules', () => {
  it('saves and loads config with custom modules', () => {
    const config: AnorakProConfig = {
      ...DEFAULT_CONFIG,
      customModules: [
        { name: 'RL Context', content: 'some data', enabled: true },
        { name: 'Spec', content: 'the spec', enabled: false },
      ],
    }
    const json = saveConfig(config)
    const loaded = loadConfig({ [CONFIG_KEY]: json })
    expect(loaded.customModules).toHaveLength(2)
    expect(loaded.customModules[0].name).toBe('RL Context')
    expect(loaded.customModules[1].enabled).toBe(false)
  })

  it('preserves empty customModules through round-trip', () => {
    const json = saveConfig(DEFAULT_CONFIG)
    const loaded = loadConfig({ [CONFIG_KEY]: json })
    expect(loaded.customModules).toEqual([])
  })

  it('old config without customModules gets default empty array via spread', () => {
    // Simulate legacy config in localStorage (no customModules field)
    const legacy = JSON.stringify({
      models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
      reviewerThreshold: 90,
      batchSize: 1,
      recapLength: 100,
      autoCurate: false,
      autoCode: false,
      contextModules: { rl: true, queued: true, allTodo: false },
    })
    const loaded = loadConfig({ [CONFIG_KEY]: legacy })
    // Spread: { ...DEFAULT_CONFIG, ...legacy } — customModules from DEFAULT survives
    expect(loaded.customModules).toEqual([])
  })

  it('config with 20 modules round-trips cleanly', () => {
    const modules = Array.from({ length: 20 }, (_, i) => ({
      name: `Mod ${i}`, content: `content ${i}`, enabled: i % 2 === 0,
    }))
    const config = { ...DEFAULT_CONFIG, customModules: modules }
    const loaded = loadConfig({ [CONFIG_KEY]: saveConfig(config) })
    expect(loaded.customModules).toHaveLength(20)
    expect(loaded.customModules[19].name).toBe('Mod 19')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// LOBEEDITOR — AbortController and try/catch in source
// ═══════════════════════════════════════════════════════════════════════════

describe('LobeEditor source — AbortController + error handling', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
  const src = fs.readFileSync(panelPath, 'utf-8')

  it('LobeEditor function exists', () => {
    expect(src).toContain('function LobeEditor({ lobe }')
  })

  it('creates AbortController in useEffect', () => {
    expect(src).toContain('const ac = new AbortController()')
  })

  it('passes signal to fetch', () => {
    expect(src).toContain('signal: ac.signal')
  })

  it('aborts on cleanup', () => {
    expect(src).toContain('return () => ac.abort()')
  })

  it('catches AbortError specifically', () => {
    expect(src).toContain("e.name !== 'AbortError'")
  })

  it('handleSave is wrapped in try/catch', () => {
    // The save function uses try { ... } catch { /* offline */ }
    expect(src).toContain('const handleSave = async ()')
    // Extract handleSave body — verify try/catch wraps the fetch
    const saveIdx = src.indexOf('const handleSave = async ()')
    const saveBlock = src.slice(saveIdx, saveIdx + 800)
    expect(saveBlock).toContain('try {')
    expect(saveBlock).toContain('catch')
  })

  it('fetch uses PUT method for save', () => {
    expect(src).toContain("method: 'PUT'")
  })

  it('sends JSON content type', () => {
    expect(src).toContain("'Content-Type': 'application/json'")
  })

  it('fetches from /api/anorak/pro/lobeprompt endpoint', () => {
    expect(src).toContain('/api/anorak/pro/lobeprompt')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ABORTCONTROLLER in MindcraftTab + CuratorLogTab
// ═══════════════════════════════════════════════════════════════════════════

describe('AbortController usage across AnorakProPanel', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
  const src = fs.readFileSync(panelPath, 'utf-8')

  it('MindcraftTab uses AbortController ref', () => {
    expect(src).toContain('const abortRef = useRef<AbortController | null>(null)')
  })

  it('MindcraftTab aborts previous fetch before new one', () => {
    expect(src).toContain('abortRef.current?.abort()')
    expect(src).toContain('abortRef.current = new AbortController()')
  })

  it('CuratorLogTab also uses AbortController', () => {
    // There should be multiple AbortController usages
    const matches = src.match(/new AbortController\(\)/g)
    expect(matches!.length).toBeGreaterThanOrEqual(3) // LobeEditor + MindcraftTab + CuratorLogTab
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMCONTEXTMODULE interface in source
// ═══════════════════════════════════════════════════════════════════════════

describe('CustomContextModule interface in source', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
  const src = fs.readFileSync(panelPath, 'utf-8')

  it('re-exports CustomContextModule type from shared config', () => {
    expect(src).toContain('export type CustomContextModule = SharedCustomContextModule')
  })

  it('CustomContextModule has name field (via shared interface)', () => {
    // The interface is defined in anorak-context-config.ts and re-exported
    const configSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/anorak-context-config.ts'), 'utf-8'
    )
    expect(configSrc).toContain('name: string')
  })

  it('CustomContextModule has content field (via shared interface)', () => {
    const configSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/anorak-context-config.ts'), 'utf-8'
    )
    expect(configSrc).toContain('content: string')
  })

  it('CustomContextModule has enabled field (via shared interface)', () => {
    const configSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/anorak-context-config.ts'), 'utf-8'
    )
    expect(configSrc).toContain('enabled: boolean')
  })

  it('AnorakProConfig includes customModules field', () => {
    expect(src).toContain('customModules: CustomContextModule[]')
  })
})
