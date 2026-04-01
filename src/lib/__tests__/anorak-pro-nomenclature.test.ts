// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// NOMENCLATURE TESTS — carbondev consistency + AgentWindowType
// Verifies the Anorak Pro Phase 1 nomenclature sweep:
//   - 'carbondev' used everywhere (not 'player1' or 'dev')
//   - AgentWindowType includes 'anorak-pro'
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// AgentWindowType includes 'anorak-pro'
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentWindowType', () => {
  it('oasisStore exports type that includes anorak-pro', () => {
    // Read the actual source to verify the type definition
    const storePath = path.resolve(__dirname, '../../store/oasisStore.ts')
    const content = fs.readFileSync(storePath, 'utf-8')

    // AgentWindowType should include 'anorak-pro'
    expect(content).toContain("'anorak-pro'")

    // Verify it's part of the AgentWindowType union
    const typeMatch = content.match(/export type AgentWindowType\s*=\s*([^;]+)/)
    expect(typeMatch).not.toBeNull()
    expect(typeMatch![1]).toContain('anorak-pro')
  })

  it('AgentWindowType includes all expected agent types', () => {
    const storePath = path.resolve(__dirname, '../../store/oasisStore.ts')
    const content = fs.readFileSync(storePath, 'utf-8')

    const typeMatch = content.match(/export type AgentWindowType\s*=\s*([^;]+)/)
    expect(typeMatch).not.toBeNull()

    const typeDef = typeMatch![1]
    expect(typeDef).toContain('anorak')
    expect(typeDef).toContain('anorak-pro')
    expect(typeDef).toContain('merlin')
    expect(typeDef).toContain('devcraft')
    expect(typeDef).toContain('parzival')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// NOMENCLATURE: carbondev used consistently
// ═══════════════════════════════════════════════════════════════════════════

describe('carbondev nomenclature', () => {
  it('anorak-curator-rl uses carbondev (not player1)', () => {
    const filePath = path.resolve(__dirname, '../anorak-curator-rl.ts')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('carbondev')
    expect(content).not.toContain("'player1'")
  })

  it('feedback route uses carbondev actor', () => {
    const filePath = path.resolve(__dirname, '../../app/api/anorak/pro/feedback/route.ts')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain("actor: 'carbondev'")
    expect(content).not.toContain("actor: 'player1'")
    expect(content).not.toContain("actor: 'dev'")
  })

  it('ParzivalMissions uses carbondev (not player1)', () => {
    const filePath = path.resolve(__dirname, '../../components/forge/ParzivalMissions.tsx')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('carbondev')
    expect(content).not.toContain("'player1'")
  })

  it('Mindcraft2 uses carbondev (not player1)', () => {
    const filePath = path.resolve(__dirname, '../../components/forge/Mindcraft2.tsx')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('carbondev')
    expect(content).not.toContain("'player1'")
  })

  it('MCP server assigns to carbondev after curator maturation', () => {
    const filePath = path.resolve(__dirname, '../../../tools/mission-mcp/index.js')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('"carbondev"')
    expect(content).not.toContain('"player1"')
  })

  it('curator-rl formatThread filters for carbondev actor', () => {
    const filePath = path.resolve(__dirname, '../anorak-curator-rl.ts')
    const content = fs.readFileSync(filePath, 'utf-8')
    // Should filter for curator and carbondev
    expect(content).toContain("e.actor === 'carbondev'")
    expect(content).not.toContain("e.actor === 'player1'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK PRO ROUTES EXIST
// ═══════════════════════════════════════════════════════════════════════════

describe('Anorak Pro route files exist', () => {
  const routes = [
    'src/app/api/anorak/pro/feedback/route.ts',
    'src/app/api/anorak/pro/curate/route.ts',
    'src/app/api/anorak/pro/execute/route.ts',
  ]

  for (const route of routes) {
    it(`${route} exists and exports POST`, () => {
      const filePath = path.resolve(__dirname, '../../../', route)
      expect(fs.existsSync(filePath)).toBe(true)
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).toContain('export async function POST')
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// MCP SERVER TOOLS
// ═══════════════════════════════════════════════════════════════════════════

describe('mission-mcp tool definitions', () => {
  const mcpPath = path.resolve(__dirname, '../../../tools/mission-mcp/index.js')

  it('defines all 8 expected tools', () => {
    const content = fs.readFileSync(mcpPath, 'utf-8')
    const tools = ['get_mission', 'get_missions_queue', 'mature_mission', 'report_review', 'report_test', 'report_game', 'create_para_mission', 'create_pashyanti_mission']
    for (const tool of tools) {
      expect(content).toContain(`"${tool}"`)
    }
  })

  it('mature_mission assigns to carbondev', () => {
    const content = fs.readFileSync(mcpPath, 'utf-8')
    // After enrichment, mission goes to carbondev for review
    expect(content).toContain('assignedTo: "carbondev"')
  })

  it('create_para_mission defaults assignedTo anorak', () => {
    const content = fs.readFileSync(mcpPath, 'utf-8')
    expect(content).toContain('assignedTo: "anorak"')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// WIZARD CONSOLE — AGENT_TYPES includes anorak-pro
// ═══════════════════════════════════════════════════════════════════════════

describe('WizardConsole AGENT_TYPES', () => {
  it('includes anorak-pro agent type', () => {
    const filePath = path.resolve(__dirname, '../../components/forge/wizard/AgentsTab.tsx')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain("type: 'anorak-pro'")
    expect(content).toContain("label: 'Anorak Pro'")
  })
})
