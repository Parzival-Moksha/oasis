// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO CONFIG — Unit tests for Phase 2
// Tests: DEFAULT_CONFIG structure, loadConfig/saveConfig logic,
//        curator-logs route existence, DevcraftPanel filter
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// Extract pure logic from AnorakProPanel for testing (no React deps)
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

// Mirrors loadConfig from AnorakProPanel.tsx
function loadConfig(storage: Record<string, string | null>): AnorakProConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(storage[CONFIG_KEY] || 'null') }
  } catch {
    return DEFAULT_CONFIG
  }
}

// Mirrors saveConfig logic
function saveConfig(c: AnorakProConfig): string {
  return JSON.stringify(c)
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT_CONFIG STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProConfig DEFAULT_CONFIG', () => {
  it('has 4 model slots', () => {
    expect(Object.keys(DEFAULT_CONFIG.models)).toEqual(['curator', 'coder', 'reviewer', 'tester'])
  })

  it('curator defaults to sonnet', () => {
    expect(DEFAULT_CONFIG.models.curator).toBe('sonnet')
  })

  it('coder defaults to opus', () => {
    expect(DEFAULT_CONFIG.models.coder).toBe('opus')
  })

  it('reviewer defaults to sonnet', () => {
    expect(DEFAULT_CONFIG.models.reviewer).toBe('sonnet')
  })

  it('tester defaults to sonnet', () => {
    expect(DEFAULT_CONFIG.models.tester).toBe('sonnet')
  })

  it('reviewerThreshold defaults to 90', () => {
    expect(DEFAULT_CONFIG.reviewerThreshold).toBe(90)
  })

  it('batchSize defaults to 1', () => {
    expect(DEFAULT_CONFIG.batchSize).toBe(1)
  })

  it('recapLength defaults to 100', () => {
    expect(DEFAULT_CONFIG.recapLength).toBe(100)
  })

  it('autoCurate defaults to false', () => {
    expect(DEFAULT_CONFIG.autoCurate).toBe(false)
  })

  it('autoCode defaults to false', () => {
    expect(DEFAULT_CONFIG.autoCode).toBe(false)
  })

  it('contextModules.rl defaults to true', () => {
    expect(DEFAULT_CONFIG.contextModules.rl).toBe(true)
  })

  it('contextModules.queued defaults to true', () => {
    expect(DEFAULT_CONFIG.contextModules.queued).toBe(true)
  })

  it('contextModules.allTodo defaults to false', () => {
    expect(DEFAULT_CONFIG.contextModules.allTodo).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// loadConfig
// ═══════════════════════════════════════════════════════════════════════════

describe('loadConfig', () => {
  it('returns DEFAULT_CONFIG when storage is empty', () => {
    const result = loadConfig({ [CONFIG_KEY]: null })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('returns DEFAULT_CONFIG when storage has invalid JSON', () => {
    const result = loadConfig({ [CONFIG_KEY]: 'not json at all' })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('merges partial config with defaults', () => {
    const partial = JSON.stringify({ batchSize: 5, autoCurate: true })
    const result = loadConfig({ [CONFIG_KEY]: partial })
    expect(result.batchSize).toBe(5)
    expect(result.autoCurate).toBe(true)
    // Defaults preserved for unset fields
    expect(result.reviewerThreshold).toBe(90)
    expect(result.models).toEqual(DEFAULT_CONFIG.models)
  })

  it('overrides all fields when full config provided', () => {
    const full: AnorakProConfig = {
      models: { curator: 'opus', coder: 'opus', reviewer: 'opus', tester: 'opus' },
      reviewerThreshold: 80,
      batchSize: 3,
      recapLength: 50,
      autoCurate: true,
      autoCode: true,
      contextModules: { rl: false, queued: false, allTodo: true },
    }
    const result = loadConfig({ [CONFIG_KEY]: JSON.stringify(full) })
    expect(result).toEqual(full)
  })

  it('returns DEFAULT_CONFIG when storage value is string "null"', () => {
    const result = loadConfig({ [CONFIG_KEY]: 'null' })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('handles empty object in storage gracefully', () => {
    const result = loadConfig({ [CONFIG_KEY]: '{}' })
    // Spread of empty object over defaults = defaults
    expect(result).toEqual(DEFAULT_CONFIG)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// saveConfig
// ═══════════════════════════════════════════════════════════════════════════

describe('saveConfig', () => {
  it('serializes config to JSON string', () => {
    const json = saveConfig(DEFAULT_CONFIG)
    const parsed = JSON.parse(json)
    expect(parsed.batchSize).toBe(1)
    expect(parsed.models.coder).toBe('opus')
  })

  it('round-trips through save/load', () => {
    const modified = { ...DEFAULT_CONFIG, batchSize: 7, autoCurate: true }
    const json = saveConfig(modified)
    const loaded = loadConfig({ [CONFIG_KEY]: json })
    expect(loaded.batchSize).toBe(7)
    expect(loaded.autoCurate).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE VERIFICATION — AnorakProPanel exports match our mirror
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel source verification', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')

  it('exports AnorakProConfig interface', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('export interface AnorakProConfig')
  })

  it('has loadConfig function with SSR guard', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain("if (typeof window === 'undefined') return DEFAULT_CONFIG")
  })

  it('has saveConfig function using CONFIG_KEY', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('function saveConfig')
    expect(content).toContain('localStorage.setItem(CONFIG_KEY')
  })

  it('DEFAULT_CONFIG has autoCurate: false', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('autoCurate: false')
  })

  it('DEFAULT_CONFIG has autoCode: false', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('autoCode: false')
  })

  it('has LobeEditor component', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('function LobeEditor')
  })

  it('auto-curate polls every 10s', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('setInterval(checkAndCurate, 10000)')
  })

  it('auto-curate checks isAgentRunning before starting', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('!isAgentRunning')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR-LOGS ROUTE
// ═══════════════════════════════════════════════════════════════════════════

describe('curator-logs route', () => {
  const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/curator-logs/route.ts')

  it('route file exists', () => {
    expect(fs.existsSync(routePath)).toBe(true)
  })

  it('exports GET handler', () => {
    const content = fs.readFileSync(routePath, 'utf-8')
    expect(content).toContain('export async function GET')
  })

  it('queries curatorLog model', () => {
    const content = fs.readFileSync(routePath, 'utf-8')
    expect(content).toContain('prisma.curatorLog.findMany')
  })

  it('orders by startedAt desc', () => {
    const content = fs.readFileSync(routePath, 'utf-8')
    expect(content).toContain("orderBy: { startedAt: 'desc' }")
  })

  it('limits to 50 entries', () => {
    const content = fs.readFileSync(routePath, 'utf-8')
    expect(content).toContain('take: 50')
  })

  it('returns NextResponse.json', () => {
    const content = fs.readFileSync(routePath, 'utf-8')
    expect(content).toContain('NextResponse.json(logs)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DEVCRAFT PANEL — filter uses carbondev
// ═══════════════════════════════════════════════════════════════════════════

describe('DevcraftPanel filter', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/DevcraftPanel.tsx')

  it('fetches missions with assignedTo=carbondev', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).toContain('/api/missions?assignedTo=carbondev')
  })

  it('does not use old player1 filter', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).not.toContain('assignedTo=player1')
  })

  it('does not use assignedTo=dev filter', () => {
    const content = fs.readFileSync(panelPath, 'utf-8')
    expect(content).not.toContain('assignedTo=dev')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CuratorLog schema exists in Prisma
// ═══════════════════════════════════════════════════════════════════════════

describe('CuratorLog Prisma model', () => {
  const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma')

  it('model CuratorLog is defined', () => {
    const content = fs.readFileSync(schemaPath, 'utf-8')
    expect(content).toContain('model CuratorLog')
  })

  it('has status field with default running', () => {
    const content = fs.readFileSync(schemaPath, 'utf-8')
    expect(content).toContain('@default("running")')
  })

  it('has startedAt and endedAt fields', () => {
    const content = fs.readFileSync(schemaPath, 'utf-8')
    expect(content).toContain('startedAt')
    expect(content).toContain('endedAt')
  })
})
