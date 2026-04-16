// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO HEARTBEAT — Unit tests for anorak-pro lobe config,
// heartbeat route source verification, agent definition validation
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

import {
  ANORAK_LOBES,
  isAnorakLobe,
  DEFAULT_LOBE_MODULES,
  BUILT_IN_MODULE_IDS,
  normalizeLobeModules,
  getContextModuleCatalog,
} from '@/lib/anorak-context-config'

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK_LOBES — anorak-pro membership
// ═══════════════════════════════════════════════════════════════════════════

describe('ANORAK_LOBES includes anorak-pro', () => {
  it('anorak-pro is in the ANORAK_LOBES array', () => {
    expect(ANORAK_LOBES).toContain('anorak-pro')
  })

  it('isAnorakLobe("anorak-pro") returns true', () => {
    expect(isAnorakLobe('anorak-pro')).toBe(true)
  })

  it('isAnorakLobe rejects unknown lobes', () => {
    expect(isAnorakLobe('hacker')).toBe(false)
    expect(isAnorakLobe('')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT_LOBE_MODULES — anorak-pro default modules
// ═══════════════════════════════════════════════════════════════════════════

describe('DEFAULT_LOBE_MODULES has anorak-pro key', () => {
  it('anorak-pro key exists', () => {
    expect(DEFAULT_LOBE_MODULES).toHaveProperty('anorak-pro')
  })

  it('anorak-pro defaults include memory module', () => {
    expect(DEFAULT_LOBE_MODULES['anorak-pro']).toContain(BUILT_IN_MODULE_IDS.memory)
  })

  it('anorak-pro defaults include rl module', () => {
    expect(DEFAULT_LOBE_MODULES['anorak-pro']).toContain(BUILT_IN_MODULE_IDS.rl)
  })

  it('anorak-pro defaults include queued module', () => {
    expect(DEFAULT_LOBE_MODULES['anorak-pro']).toContain(BUILT_IN_MODULE_IDS.queued)
  })

  it('anorak-pro defaults include topAnorak module', () => {
    expect(DEFAULT_LOBE_MODULES['anorak-pro']).toContain(BUILT_IN_MODULE_IDS.topAnorak)
  })

  it('anorak-pro has exactly 5 default modules', () => {
    expect(DEFAULT_LOBE_MODULES['anorak-pro']).toHaveLength(5)
  })

  it('anorak-pro defaults include pipeline module', () => {
    expect(DEFAULT_LOBE_MODULES['anorak-pro']).toContain(BUILT_IN_MODULE_IDS.pipeline)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUILT_IN_MODULE_IDS.memory
// ═══════════════════════════════════════════════════════════════════════════

describe('BUILT_IN_MODULE_IDS.memory', () => {
  it('memory key exists', () => {
    expect(BUILT_IN_MODULE_IDS).toHaveProperty('memory')
  })

  it('memory value is builtin:anorak-memory', () => {
    expect(BUILT_IN_MODULE_IDS.memory).toBe('builtin:anorak-memory')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// normalizeLobeModules — anorak-pro key in output
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeLobeModules includes anorak-pro', () => {
  it('returns anorak-pro key when called with empty input', () => {
    const result = normalizeLobeModules(null, [])
    expect(result).toHaveProperty('anorak-pro')
  })

  it('anorak-pro defaults to DEFAULT_LOBE_MODULES values', () => {
    const result = normalizeLobeModules(null, [])
    expect(result['anorak-pro']).toEqual(DEFAULT_LOBE_MODULES['anorak-pro'])
  })

  it('anorak-pro preserved when other lobes overridden', () => {
    const result = normalizeLobeModules({ curator: [] }, [])
    expect(result['anorak-pro']).toEqual(DEFAULT_LOBE_MODULES['anorak-pro'])
  })

  it('anorak-pro can be overridden via explicit input', () => {
    const result = normalizeLobeModules({ 'anorak-pro': [BUILT_IN_MODULE_IDS.memory] }, [])
    expect(result['anorak-pro']).toEqual([BUILT_IN_MODULE_IDS.memory])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getContextModuleCatalog — Anorak Memory entry
// ═══════════════════════════════════════════════════════════════════════════

describe('getContextModuleCatalog includes Anorak Memory', () => {
  it('catalog contains entry with id builtin:anorak-memory', () => {
    const catalog = getContextModuleCatalog([])
    const memoryEntry = catalog.find(e => e.id === 'builtin:anorak-memory')
    expect(memoryEntry).toBeDefined()
  })

  it('Anorak Memory entry has correct name', () => {
    const catalog = getContextModuleCatalog([])
    const memoryEntry = catalog.find(e => e.id === 'builtin:anorak-memory')
    expect(memoryEntry!.name).toBe('Anorak Memory')
  })

  it('Anorak Memory entry is builtin kind', () => {
    const catalog = getContextModuleCatalog([])
    const memoryEntry = catalog.find(e => e.id === 'builtin:anorak-memory')
    expect(memoryEntry!.kind).toBe('builtin')
  })

  it('Anorak Memory description mentions anorak-memory.md', () => {
    const catalog = getContextModuleCatalog([])
    const memoryEntry = catalog.find(e => e.id === 'builtin:anorak-memory')
    expect(memoryEntry!.description).toContain('anorak-memory.md')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// HEARTBEAT ROUTE — source verification
// ═══════════════════════════════════════════════════════════════════════════

describe('heartbeat route — source verification', () => {
  const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/heartbeat/route.ts')

  it('route file exists on disk', () => {
    expect(fs.existsSync(routePath)).toBe(true)
  })

  it('exports POST handler', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('export async function POST')
  })

  it('spawns anorak-pro agent', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("'--agent', 'anorak-pro'")
  })

  it('reads oasisspec3.txt', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('oasisspec3.txt')
  })

  it('uses buildHeartbeatPrompt to compose prompt', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain('buildHeartbeatPrompt')
  })

  it('resolves CEHQ modules for anorak-pro lobe', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("lobe: 'anorak-pro'")
  })

  it('uses SSE streaming response', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("'Content-Type': 'text/event-stream'")
  })

  it('validates model whitelist (opus/sonnet/haiku)', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("VALID_MODELS = ['opus', 'sonnet', 'haiku']")
  })

  it('uses --output-format stream-json', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("'--output-format', 'stream-json'")
  })

  it('handles request abort signal', () => {
    const src = fs.readFileSync(routePath, 'utf-8')
    expect(src).toContain("request.signal.addEventListener('abort'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AGENT DEFINITION — anorak-pro.md
// ═══════════════════════════════════════════════════════════════════════════

describe('agent definition — anorak-pro.md', () => {
  const agentPath = path.resolve(__dirname, '../../../.claude/agents/anorak-pro.md')

  it('agent file exists on disk', () => {
    expect(fs.existsSync(agentPath)).toBe(true)
  })

  it('contains Phase heading and self-building vision', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('Phase')
    expect(src).toContain('build rate')
  })

  it('mentions create_para_mission MCP tool', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('create_para_mission')
  })

  it('mentions get_missions_queue MCP tool', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('get_missions_queue')
  })

  it('mentions create_pashyanti_mission MCP tool', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('create_pashyanti_mission')
  })

  it('mentions mature_mission MCP tool', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('mature_mission')
  })

  it('contains memory protocol referencing tools/anorak-memory.md', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('tools/anorak-memory.md')
  })

  it('describes Heartbeat Mode', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('Heartbeat Mode')
  })

  it('describes Noble Eightfold Path', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('Noble Eightfold Path')
  })

  it('describes Accountability Protocol', () => {
    const src = fs.readFileSync(agentPath, 'utf-8')
    expect(src).toContain('Accountability Protocol')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK CONTEXT MODULES — memory resolver in source
// ═══════════════════════════════════════════════════════════════════════════

describe('anorak-context-modules — memory resolver', () => {
  const modulesPath = path.resolve(__dirname, '../anorak-context-modules.ts')

  it('handles BUILT_IN_MODULE_IDS.memory case', () => {
    const src = fs.readFileSync(modulesPath, 'utf-8')
    expect(src).toContain('case BUILT_IN_MODULE_IDS.memory')
  })

  it('reads tools/anorak-memory.md from disk', () => {
    const src = fs.readFileSync(modulesPath, 'utf-8')
    expect(src).toContain("'tools', 'anorak-memory.md'")
  })

  it('returns fallback message when file not found', () => {
    const src = fs.readFileSync(modulesPath, 'utf-8')
    expect(src).toContain('anorak-memory.md not found')
  })

  it('returns ResolvedContextModule with name Anorak Memory', () => {
    const src = fs.readFileSync(modulesPath, 'utf-8')
    expect(src).toContain("name: 'Anorak Memory'")
  })
})
