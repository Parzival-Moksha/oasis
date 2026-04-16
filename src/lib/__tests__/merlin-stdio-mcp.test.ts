import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const merlinRoutePath = path.resolve(__dirname, '../../app/api/merlin/route.ts')
const oasisMcpPath = path.resolve(__dirname, '../../../tools/oasis-mcp/index.js')

describe('merlin stdio MCP wiring', () => {
  it('pins the Oasis MCP server to Merlin defaults in the session config', () => {
    const source = fs.readFileSync(merlinRoutePath, 'utf-8')

    expect(source).toContain("OASIS_URL: process.env.OASIS_URL || 'http://localhost:4516'")
    expect(source).toContain("OASIS_AGENT_TYPE: 'merlin'")
  })

  it('exposes screenshot_viewport from the stdio Oasis MCP server', () => {
    const source = fs.readFileSync(oasisMcpPath, 'utf-8')

    expect(source).toContain('OASIS_MCP_TOOL_SPECS')
    expect(source).toContain('prepareOasisToolArgs')
    expect(source).toContain('compactScreenshotProxyResult')
  })

  it('lets Merlin target its own avatar without requiring avatarId every time', () => {
    const source = fs.readFileSync(oasisMcpPath, 'utf-8')

    // Shared spec + stdio context pin Merlin as the default actor identity.
    expect(source).toContain('function normalizeAgentType(')
    expect(source).toContain('PINNED_WORLD_ID')
    expect(source).toContain('DEFAULT_AGENT_TYPE')
  })
})
