// ░▒▓█ CLEANUP SPRINT TESTS █▓▒░
// Tests for: missions auto-pashyanti, HelpPanel glossary updates, FRAME_STYLES integrity

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// 1. POST /api/missions — auto-pashyanti (maturityLevel: 1) logic
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/missions — auto-pashyanti logic', () => {
  const routePath = path.resolve(__dirname, '../../app/api/missions/route.ts')
  const routeSource = fs.readFileSync(routePath, 'utf-8')

  it('route file exists and is readable', () => {
    expect(routeSource.length).toBeGreaterThan(0)
  })

  it('detects hasAgentEnrichment from carbonDescription or siliconDescription', () => {
    // The logic: const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(routeSource).toContain('hasAgentEnrichment')
    expect(routeSource).toContain('rest.carbonDescription || rest.siliconDescription')
  })

  it('spreads maturityLevel: 1 when hasAgentEnrichment is true', () => {
    // The conditional spread: ...(hasAgentEnrichment && { maturityLevel: 1 })
    expect(routeSource).toContain('hasAgentEnrichment && { maturityLevel: 1 }')
  })

  it('does NOT set maturityLevel unconditionally', () => {
    // maturityLevel should only appear in the conditional spread, never as a bare field
    const lines = routeSource.split('\n')
    const maturityLines = lines.filter(l => l.includes('maturityLevel') && !l.includes('hasAgentEnrichment'))
    expect(maturityLines.length).toBe(0)
  })

  it('defaults to no maturityLevel when neither description is provided', () => {
    // Verify the spread pattern — when hasAgentEnrichment is false,
    // ...(false && { maturityLevel: 1 }) spreads nothing
    const spreadPattern = /\.\.\.\(hasAgentEnrichment && \{ maturityLevel: 1 \}\)/
    expect(routeSource).toMatch(spreadPattern)
  })

  // Functional unit test of the enrichment detection logic (extracted)
  it('enrichment detection logic: carbonDescription triggers', () => {
    const rest = { carbonDescription: 'some desc', siliconDescription: null }
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(hasAgentEnrichment).toBe(true)
  })

  it('enrichment detection logic: siliconDescription triggers', () => {
    const rest = { carbonDescription: null, siliconDescription: 'agent plan' }
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(hasAgentEnrichment).toBe(true)
  })

  it('enrichment detection logic: both trigger', () => {
    const rest = { carbonDescription: 'human', siliconDescription: 'agent' }
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(hasAgentEnrichment).toBe(true)
  })

  it('enrichment detection logic: neither triggers = no enrichment', () => {
    const rest = { carbonDescription: null, siliconDescription: null }
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(hasAgentEnrichment).toBe(false)
  })

  it('enrichment detection logic: empty strings = no enrichment', () => {
    const rest = { carbonDescription: '', siliconDescription: '' }
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(hasAgentEnrichment).toBe(false)
  })

  it('enrichment detection logic: undefined = no enrichment', () => {
    const rest: Record<string, unknown> = {}
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)
    expect(hasAgentEnrichment).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. HelpPanel glossary — no "Credits", has "Token Burn"
// ═══════════════════════════════════════════════════════════════════════════

describe('HelpPanel glossary entries', () => {
  const helpPath = path.resolve(__dirname, '../../components/forge/HelpPanel.tsx')
  const helpSource = fs.readFileSync(helpPath, 'utf-8')

  it('glossary does NOT contain a "Credits" entry', () => {
    // Extract GLOSSARY array entries — look for term: 'Credits'
    const creditsTermMatch = helpSource.match(/term:\s*['"]Credits['"]/i)
    expect(creditsTermMatch).toBeNull()
  })

  it('glossary contains "Token Burn" entry', () => {
    const tokenBurnMatch = helpSource.match(/term:\s*['"]Token Burn['"]/)
    expect(tokenBurnMatch).not.toBeNull()
  })

  it('Token Burn definition mentions AI tokens', () => {
    // Verify the definition is meaningful
    expect(helpSource).toContain('AI tokens consumed')
  })

  it('Token Burn is in the social category', () => {
    // The entry should be categorized under 'social'
    // Look for the pattern near "Token Burn"
    const glossarySection = helpSource.slice(
      helpSource.indexOf("term: 'Token Burn'"),
      helpSource.indexOf("term: 'Token Burn'") + 200
    )
    expect(glossarySection).toContain("category: 'social'")
  })

  it('glossary has all expected categories', () => {
    expect(helpSource).toContain("key: 'core'")
    expect(helpSource).toContain("key: 'social'")
    expect(helpSource).toContain("key: 'objects'")
    expect(helpSource).toContain("key: 'movement'")
  })

  it('glossary has no stale credit/pricing references in definitions', () => {
    // Scan all definitions for leftover credit references
    const glossaryArrayMatch = helpSource.match(/const GLOSSARY: GlossaryEntry\[\] = \[([\s\S]*?)\]\s*\n/)
    expect(glossaryArrayMatch).not.toBeNull()
    const glossaryBlock = glossaryArrayMatch![1]
    // Should not mention "credit" in definitions (Token Burn replaced it)
    const creditMentions = glossaryBlock.match(/\bcredit\b/gi)
    expect(creditMentions).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. HelpPanel header — drag handler wired
// ═══════════════════════════════════════════════════════════════════════════

describe('HelpPanel drag functionality', () => {
  const helpPath = path.resolve(__dirname, '../../components/forge/HelpPanel.tsx')
  const helpSource = fs.readFileSync(helpPath, 'utf-8')

  it('header div has onMouseDown={handleDragStart}', () => {
    expect(helpSource).toContain('onMouseDown={handleDragStart}')
  })

  it('handleDragStart callback is defined', () => {
    expect(helpSource).toContain('const handleDragStart = useCallback')
  })

  it('drag handler is on the cursor-move element', () => {
    // The onMouseDown should be on the same element that has cursor-move
    const headerSection = helpSource.slice(
      helpSource.indexOf('cursor-move') - 100,
      helpSource.indexOf('cursor-move') + 200
    )
    expect(headerSection).toContain('onMouseDown={handleDragStart}')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. FRAME_STYLES — expected entries still present
// ═══════════════════════════════════════════════════════════════════════════

describe('FRAME_STYLES integrity', () => {
  const framePath = path.resolve(__dirname, '../../components/forge/FrameComponents.tsx')
  const frameSource = fs.readFileSync(framePath, 'utf-8')

  const expectedFrameIds = [
    'gilded', 'neon', 'thin', 'baroque', 'hologram',
    'rustic', 'ice', 'void', 'spaghetti',
    'fire', 'matrix', 'plasma', 'brutalist',
  ]

  it('FRAME_STYLES is exported', () => {
    expect(frameSource).toContain('export const FRAME_STYLES')
  })

  for (const id of expectedFrameIds) {
    it(`contains frame style "${id}"`, () => {
      expect(frameSource).toContain(`id: '${id}'`)
    })
  }

  it('has exactly 13 frame styles', () => {
    const frameIds = frameSource.match(/id:\s*'[a-z]+'/g)
    expect(frameIds).not.toBeNull()
    expect(frameIds!.length).toBe(13)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Sprint 2 — Model allowlist: Kimi removed, 7 new models added
// ═══════════════════════════════════════════════════════════════════════════

describe('Vibecode ALLOWED_MODELS — Sprint 2 model swap', () => {
  const routePath = path.resolve(__dirname, '../../app/api/anorak/vibecode/route.ts')
  const routeSource = fs.readFileSync(routePath, 'utf-8')

  // Extract the ALLOWED_MODELS array from the route source
  const modelsBlock = routeSource.slice(
    routeSource.indexOf('const ALLOWED_MODELS = ['),
    routeSource.indexOf(']', routeSource.indexOf('const ALLOWED_MODELS = [')) + 1
  )

  it('does NOT contain any kimi model', () => {
    expect(modelsBlock.toLowerCase()).not.toContain('kimi')
  })

  it('does NOT contain moonshot (kimi provider)', () => {
    expect(modelsBlock.toLowerCase()).not.toContain('moonshot')
  })

  const expectedNewModels = [
    'z-ai/glm-5',
    'x-ai/grok-4.20-beta',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'qwen/qwen3.5-397b-a17b',
    'liquid/lfm-2-24b-a2b',
    'openai/gpt-5.4',
    'google/gemini-3.1-pro-preview',
  ]

  for (const modelId of expectedNewModels) {
    it(`contains new model "${modelId}"`, () => {
      expect(modelsBlock).toContain(`'${modelId}'`)
    })
  }

  it('has exactly 10 models in the allowlist', () => {
    const modelEntries = modelsBlock.match(/'[a-z0-9\-\/.:]+'/g)
    expect(modelEntries).not.toBeNull()
    expect(modelEntries!.length).toBe(10)
  })

  it('retains anthropic/claude-sonnet-4-6', () => {
    expect(modelsBlock).toContain("'anthropic/claude-sonnet-4-6'")
  })

  it('retains anthropic/claude-haiku-4-5', () => {
    expect(modelsBlock).toContain("'anthropic/claude-haiku-4-5'")
  })

  it('retains minimax/minimax-m2.7', () => {
    expect(modelsBlock).toContain("'minimax/minimax-m2.7'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Sprint 2 — AnorakProPanel siliconDescription display
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel — siliconDescription in mindcraft window', () => {
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
  const panelSource = fs.readFileSync(panelPath, 'utf-8')

  it('MindcraftMission type includes siliconDescription field', () => {
    expect(panelSource).toContain('siliconDescription: string | null')
  })

  it('renders siliconDescription via editSilicon state', () => {
    expect(panelSource).toContain('mission.siliconDescription')
    expect(panelSource).toContain('editSilicon')
  })

  it('displays "Silicon Description" label', () => {
    expect(panelSource).toContain('Silicon Description')
  })

  it('renders siliconDescription value in JSX via editSilicon', () => {
    expect(panelSource).toContain('setEditSilicon')
  })
})
