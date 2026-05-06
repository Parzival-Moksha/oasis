import { describe, expect, it } from 'vitest'

import {
  buildHermesMcpServerBlock,
  upsertHermesMcpServerConfig,
} from '../hermes-mcp-config-guard.mjs'

describe('Hermes MCP config guard', () => {
  it('adds a new mcp_servers block when Hermes config has none', () => {
    const next = upsertHermesMcpServerConfig('default_model: hermes\n', {
      serverName: 'oasis',
      url: 'http://127.0.0.1:17891/mcp',
      tools: ['get_world_info', 'place_object'],
    })

    expect(next).toContain('default_model: hermes')
    expect(next).toContain('mcp_servers:')
    expect(next).toContain('  oasis:')
    expect(next).toContain('    url: "http://127.0.0.1:17891/mcp"')
    expect(next).toContain('      include: [get_world_info, place_object]')
    expect(next).toContain('      prompts: false')
    expect(next).toContain('      resources: false')
  })

  it('replaces only the Oasis server under an existing mcp_servers block', () => {
    const current = [
      'default_model: hermes',
      'mcp_servers:',
      '  filesystem:',
      '    command: "npx"',
      '    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]',
      '  oasis:',
      '    url: "http://127.0.0.1:4516/api/mcp/oasis"',
      '    enabled: false',
      'provider_routing:',
      '  enabled: true',
      '',
    ].join('\n')

    const next = upsertHermesMcpServerConfig(current, {
      serverName: 'oasis',
      url: 'http://127.0.0.1:17891/mcp',
      tools: ['get_world_info'],
    })

    expect(next).toContain('  filesystem:\n    command: "npx"')
    expect(next).toContain('  oasis:\n    url: "http://127.0.0.1:17891/mcp"')
    expect(next).not.toContain('http://127.0.0.1:4516/api/mcp/oasis')
    expect(next).toContain('provider_routing:\n  enabled: true')
  })

  it('rejects unsafe server names before writing YAML', () => {
    expect(() => buildHermesMcpServerBlock({
      serverName: 'oasis: nope',
      url: 'http://127.0.0.1:17891/mcp',
    })).toThrow(/Unsafe Hermes MCP server name/)
  })
})
