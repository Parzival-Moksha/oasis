// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO PIPELINE WIRING — Unit tests for curate/route.ts validation
// + AnorakProPanel.tsx handleCurate/handleExecute/auto-code wiring
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// Mirror curate/route.ts types + pure functions for unit testing
// (no Next.js runtime required)
// ═══════════════════════════════════════════════════════════════════════════

interface ContextModuleConfig {
  rl?: boolean
  queued?: boolean
  allTodo?: boolean
}

interface CustomModule {
  name: string
  content: string
  enabled?: boolean
}

// Replicate buildCuratorPrompt exactly from curate/route.ts
function buildCuratorPrompt(
  missions: { id: number; name: string; description: string | null; history: string | null; maturityLevel: number }[],
  contextModules?: ContextModuleConfig,
  customModules?: CustomModule[],
): string {
  const missionBlock = missions.map(m => {
    const historyStr = m.history ? `\nHistory:\n${m.history}` : ''
    return `## Mission #${m.id}: "${m.name}" (level ${m.maturityLevel})
Description: ${m.description || '(none)'}${historyStr}`
  }).join('\n\n---\n\n')

  const contextInstructions: string[] = []

  if (contextModules?.rl !== false) {
    contextInstructions.push('Read context/curator-rl.md for reinforcement learning signal (if it exists).')
  } else {
    contextInstructions.push('SKIP reading context/curator-rl.md — RL signal is disabled for this invocation.')
  }
  if (contextModules?.queued) {
    contextInstructions.push('Use get_missions_queue MCP tool to see all queued missions for cross-cutting context.')
  }
  if (contextModules?.allTodo) {
    contextInstructions.push('Use get_missions_queue MCP tool with status=todo to see all TODO missions.')
  }

  contextInstructions.push('Read CLAUDE.md for project context.')

  const customBlock = (customModules || [])
    .filter(m => m.enabled !== false && m.content?.trim())
    .map(m => `## Context Module: ${m.name}\n${m.content}`)
    .join('\n\n')

  return `You are the Curator agent. Mature the following mission(s).

${contextInstructions.join('\n')}

For EACH mission:
1. Deep-dive the codebase (12-step methodology from your agent definition)
2. Write carbon description (vibes, zero jargon) and silicon description (precise spec)
3. Estimate flawless%, tag dharma paths, generate silicondev voice
4. Use the mature_mission MCP tool to write enrichment to the DB

${missionBlock}${customBlock ? `\n\n---\n\n${customBlock}` : ''}`
}

// Replicate server-side customModules sanitization from curate/route.ts
function sanitizeCustomModules(raw: unknown): CustomModule[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((m): m is CustomModule => m && typeof m.name === 'string' && typeof m.content === 'string')
    .slice(0, 20)
    .map(m => ({
      name: m.name.replace(/[#\n\r]/g, '').slice(0, 100),
      content: m.content.slice(0, 10000),
      enabled: m.enabled,
    }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Server-side customModules sanitization
// ═══════════════════════════════════════════════════════════════════════════

describe('curate/route — customModules sanitization', () => {
  it('strips # characters from module names', () => {
    const result = sanitizeCustomModules([{ name: '## My Module ##', content: 'test', enabled: true }])
    expect(result[0].name).toBe(' My Module ')
  })

  it('strips newlines from module names', () => {
    const result = sanitizeCustomModules([{ name: 'line1\nline2\rline3', content: 'test', enabled: true }])
    expect(result[0].name).toBe('line1line2line3')
  })

  it('caps module name at 100 characters', () => {
    const longName = 'A'.repeat(200)
    const result = sanitizeCustomModules([{ name: longName, content: 'test', enabled: true }])
    expect(result[0].name.length).toBe(100)
  })

  it('caps module content at 10000 characters', () => {
    const longContent = 'B'.repeat(20000)
    const result = sanitizeCustomModules([{ name: 'mod', content: longContent, enabled: true }])
    expect(result[0].content.length).toBe(10000)
  })

  it('caps array at 20 modules', () => {
    const modules = Array.from({ length: 30 }, (_, i) => ({
      name: `mod-${i}`, content: `content-${i}`, enabled: true,
    }))
    const result = sanitizeCustomModules(modules)
    expect(result.length).toBe(20)
    expect(result[19].name).toBe('mod-19')
  })

  it('filters out entries with non-string name', () => {
    const result = sanitizeCustomModules([
      { name: 123 as unknown as string, content: 'test' },
      { name: 'valid', content: 'ok' },
    ])
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('valid')
  })

  it('filters out entries with non-string content', () => {
    const result = sanitizeCustomModules([
      { name: 'test', content: null as unknown as string },
      { name: 'valid', content: 'ok' },
    ])
    expect(result.length).toBe(1)
  })

  it('returns empty array for non-array input', () => {
    expect(sanitizeCustomModules(null)).toEqual([])
    expect(sanitizeCustomModules(undefined)).toEqual([])
    expect(sanitizeCustomModules('string')).toEqual([])
    expect(sanitizeCustomModules(42)).toEqual([])
  })

  it('preserves enabled flag', () => {
    const result = sanitizeCustomModules([
      { name: 'a', content: 'x', enabled: false },
      { name: 'b', content: 'y', enabled: true },
      { name: 'c', content: 'z' },
    ])
    expect(result[0].enabled).toBe(false)
    expect(result[1].enabled).toBe(true)
    expect(result[2].enabled).toBeUndefined()
  })

  it('strips # and newlines combined, then caps length', () => {
    const name = '#' + 'X'.repeat(50) + '\n' + '#' + 'Y'.repeat(100)
    const result = sanitizeCustomModules([{ name, content: 'test' }])
    // After stripping: 'X'.repeat(50) + 'Y'.repeat(100) = 150 chars, capped to 100
    expect(result[0].name.length).toBe(100)
    expect(result[0].name).not.toContain('#')
    expect(result[0].name).not.toContain('\n')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. buildCuratorPrompt — RL instruction based on toggle
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLE_MISSIONS = [
  { id: 1, name: 'Test Mission', description: 'A test', history: null, maturityLevel: 1 },
]

describe('buildCuratorPrompt — RL toggle', () => {
  it('includes RL read instruction when rl is true', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, { rl: true })
    expect(prompt).toContain('Read context/curator-rl.md for reinforcement learning signal')
    expect(prompt).not.toContain('SKIP reading context/curator-rl.md')
  })

  it('includes RL read instruction when rl is undefined (default true)', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {})
    expect(prompt).toContain('Read context/curator-rl.md for reinforcement learning signal')
    expect(prompt).not.toContain('SKIP')
  })

  it('includes RL read instruction when contextModules is undefined', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, undefined)
    expect(prompt).toContain('Read context/curator-rl.md for reinforcement learning signal')
  })

  it('includes SKIP instruction when rl is explicitly false', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, { rl: false })
    expect(prompt).toContain('SKIP reading context/curator-rl.md — RL signal is disabled for this invocation.')
    expect(prompt).not.toContain('Read context/curator-rl.md for reinforcement learning signal (if it exists).')
  })

  it('includes queued instruction when queued is true', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, { queued: true })
    expect(prompt).toContain('get_missions_queue MCP tool to see all queued missions')
  })

  it('omits queued instruction when queued is false', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, { queued: false })
    expect(prompt).not.toContain('all queued missions')
  })

  it('includes allTodo instruction when allTodo is true', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, { allTodo: true })
    expect(prompt).toContain('status=todo')
  })

  it('always includes CLAUDE.md instruction', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, { rl: false, queued: false, allTodo: false })
    expect(prompt).toContain('Read CLAUDE.md for project context.')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. buildCuratorPrompt — custom module injection
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCuratorPrompt — custom module blocks', () => {
  it('injects enabled custom modules into prompt', () => {
    const modules: CustomModule[] = [
      { name: 'Architecture Notes', content: 'Use event-driven approach', enabled: true },
    ]
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, modules)
    expect(prompt).toContain('## Context Module: Architecture Notes')
    expect(prompt).toContain('Use event-driven approach')
  })

  it('separates custom block with --- delimiter', () => {
    const modules: CustomModule[] = [
      { name: 'Mod1', content: 'Content1', enabled: true },
    ]
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, modules)
    // Custom block should follow mission block, separated by ---
    const parts = prompt.split('---')
    const lastPart = parts[parts.length - 1]
    expect(lastPart).toContain('## Context Module: Mod1')
  })

  it('excludes disabled custom modules', () => {
    const modules: CustomModule[] = [
      { name: 'Disabled', content: 'Should not appear', enabled: false },
      { name: 'Enabled', content: 'Should appear', enabled: true },
    ]
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, modules)
    expect(prompt).not.toContain('Context Module: Disabled')
    expect(prompt).toContain('Context Module: Enabled')
  })

  it('excludes modules with empty/whitespace content', () => {
    const modules: CustomModule[] = [
      { name: 'Empty', content: '', enabled: true },
      { name: 'Whitespace', content: '   ', enabled: true },
      { name: 'Valid', content: 'Real content', enabled: true },
    ]
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, modules)
    expect(prompt).not.toContain('Context Module: Empty')
    expect(prompt).not.toContain('Context Module: Whitespace')
    expect(prompt).toContain('Context Module: Valid')
  })

  it('includes multiple enabled modules in order', () => {
    const modules: CustomModule[] = [
      { name: 'First', content: 'AAA', enabled: true },
      { name: 'Second', content: 'BBB', enabled: true },
    ]
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, modules)
    const firstIdx = prompt.indexOf('Context Module: First')
    const secondIdx = prompt.indexOf('Context Module: Second')
    expect(firstIdx).toBeLessThan(secondIdx)
  })

  it('produces no custom block when array is empty', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, [])
    // No "Context Module:" header should appear
    expect(prompt).not.toContain('Context Module:')
  })

  it('produces no custom block when customModules is undefined', () => {
    const prompt = buildCuratorPrompt(SAMPLE_MISSIONS, {}, undefined)
    expect(prompt).not.toContain('Context Module:')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Token tracking uses total_input_tokens / total_output_tokens
// ═══════════════════════════════════════════════════════════════════════════

describe('curate/route — token tracking fields', () => {
  it('route source uses total_input_tokens for tokensIn', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '../../app/api/anorak/pro/curate/route.ts'), 'utf-8'
    )
    expect(routeSrc).toContain('event.total_input_tokens')
    expect(routeSrc).toContain('tokensIn = event.total_input_tokens')
  })

  it('route source uses total_output_tokens for tokensOut', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '../../app/api/anorak/pro/curate/route.ts'), 'utf-8'
    )
    expect(routeSrc).toContain('event.total_output_tokens')
    expect(routeSrc).toContain('tokensOut = event.total_output_tokens')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. AnorakProPanel — auto-code effect pattern exists
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel — auto-code useEffect', () => {
  const panelSrc = fs.readFileSync(
    path.join(__dirname, '../../components/forge/AnorakProPanel.tsx'), 'utf-8'
  )

  it('has auto-code useEffect that depends on config.autoCode', () => {
    // The auto-code effect should check config.autoCode
    expect(panelSrc).toContain('config.autoCode')
    // Should have a useEffect block that returns a clearInterval
    expect(panelSrc).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?config\.autoCode[\s\S]*?\}/)
  })

  it('auto-code filters for vaikhari (maturityLevel >= 3)', () => {
    // Should filter for vaikhari missions
    expect(panelSrc).toContain('maturityLevel >= 3')
  })

  it('auto-code sorts by priority descending', () => {
    // Priority sort: (b.priority ?? 0) - (a.priority ?? 0)
    expect(panelSrc).toMatch(/\(b\.priority\s*\?\?\s*0\)\s*-\s*\(a\.priority\s*\?\?\s*0\)/)
  })

  it('auto-code calls handleExecute for highest-priority vaikhari', () => {
    // Should call handleExecute(vaikhari[0].id)
    expect(panelSrc).toContain('handleExecute(vaikhari[0].id)')
  })

  it('auto-code effect mirrors auto-curate pattern (interval + ref guards)', () => {
    // autoCodeRef pattern mirrors autoCurateRef
    expect(panelSrc).toContain('autoCodeRef')
    expect(panelSrc).toContain('autoCodeRef.current = config.autoCode')
    expect(panelSrc).toContain('isRunningRef.current')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. handleCurate sends contextModules + customModules
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel — handleCurate sends context', () => {
  const panelSrc = fs.readFileSync(
    path.join(__dirname, '../../components/forge/AnorakProPanel.tsx'), 'utf-8'
  )

  it('handleCurate passes contextModules to consumeSSE', () => {
    // handleCurate should include config.contextModules in the body
    expect(panelSrc).toMatch(/handleCurate[\s\S]*?contextModules:\s*config\.contextModules/)
  })

  it('handleCurate passes filtered customModules to consumeSSE', () => {
    // handleCurate should filter enabled customModules before sending
    expect(panelSrc).toMatch(/handleCurate[\s\S]*?customModules:\s*\(config\.customModules/)
  })

  it('handleCurate deps include contextModules and customModules', () => {
    // The useCallback dep array should include config.contextModules and config.customModules
    expect(panelSrc).toContain('config.contextModules, config.customModules]')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. handleExecute sends customModules
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel — handleExecute sends context', () => {
  const panelSrc = fs.readFileSync(
    path.join(__dirname, '../../components/forge/AnorakProPanel.tsx'), 'utf-8'
  )

  it('handleExecute passes customModules to consumeSSE', () => {
    // handleExecute body should include customModules
    expect(panelSrc).toMatch(/handleExecute[\s\S]*?customModules:\s*\(config\.customModules/)
  })

  it('consumeSSE sends body as JSON POST', () => {
    expect(panelSrc).toContain("method: 'POST'")
    expect(panelSrc).toContain("'Content-Type': 'application/json'")
    expect(panelSrc).toContain('JSON.stringify(body)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. curate/route.ts server-side validation structure
// ═══════════════════════════════════════════════════════════════════════════

describe('curate/route — server validation structure', () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, '../../app/api/anorak/pro/curate/route.ts'), 'utf-8'
  )

  it('defines CustomModule interface with name, content, enabled', () => {
    expect(routeSrc).toContain('interface CustomModule')
    expect(routeSrc).toMatch(/name:\s*string/)
    expect(routeSrc).toMatch(/content:\s*string/)
    expect(routeSrc).toMatch(/enabled\?:\s*boolean/)
  })

  it('uses .slice(0, 20) to cap array length', () => {
    expect(routeSrc).toContain('.slice(0, 20)')
  })

  it('uses regex to strip # and newlines from names', () => {
    expect(routeSrc).toContain(".replace(/[#\\n\\r]/g, '')")
  })

  it('uses .slice(0, 100) for name cap', () => {
    expect(routeSrc).toContain('.slice(0, 100)')
  })

  it('uses .slice(0, 10000) for content cap', () => {
    expect(routeSrc).toContain('.slice(0, 10000)')
  })

  it('passes customModules to buildCuratorPrompt', () => {
    expect(routeSrc).toContain('buildCuratorPrompt(missions, contextModules, customModules)')
  })
})
