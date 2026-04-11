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

    expect(source).toContain('server.tool("screenshot_viewport"')
    // screenshot_viewport proxies through proxyOasisTool with extra args
    expect(source).toContain('proxyOasisTool("screenshot_viewport"')
    expect(source).toContain('compactScreenshotProxyResult')
  })

  it('lets Merlin target its own avatar without requiring avatarId every time', () => {
    const source = fs.readFileSync(oasisMcpPath, 'utf-8')

    // Agent type normalization resolves default avatar identity
    expect(source).toContain('function normalizeAgentType(')
    expect(source).toContain('avatarId: z.string().optional().describe("Avatar ID. Optional when the session has a default agent avatar.")')
  })
})
