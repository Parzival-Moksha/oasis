import { describe, expect, it } from 'vitest'

import { describeCodexTool, humanizeCodexItemType } from '../codex-presentation'

describe('codex-presentation', () => {
  it('labels local Oasis image API commands as Generate Image', () => {
    const tool = describeCodexTool({
      type: 'command_execution',
      command: '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Invoke-RestMethod -Uri http://127.0.0.1:4516/api/media/image -Method Post @{ model = \'gemini-flash\' }"',
    })

    expect(tool.name).toBe('Generate Image')
    expect(tool.icon).toBe('🎨')
    expect(tool.display).toContain('/api/media/image')
    expect(tool.display).toContain('gemini-flash')
  })

  it('labels local Oasis voice API commands as Generate Voice', () => {
    const tool = describeCodexTool({
      type: 'command_execution',
      command: 'powershell -Command "Invoke-RestMethod -Uri http://localhost:4516/api/media/voice/timestamps -Method Post"',
    })

    expect(tool.name).toBe('Generate Voice')
    expect(tool.icon).toBe('🔊')
    expect(tool.display).toContain('/api/media/voice/timestamps')
  })

  it('keeps generic shell commands as Shell with a concise runtime hint', () => {
    const tool = describeCodexTool({
      type: 'command_execution',
      command: 'powershell -Command "Get-ChildItem -Force; Select-String -Path src\\**\\*.ts -Pattern world-events"',
    })

    expect(tool.name).toBe('Shell')
    expect(tool.icon).toBe('⚡')
    expect(tool.display.startsWith('PowerShell:')).toBe(true)
    expect(tool.display).not.toContain('C:\\Windows\\System32')
  })

  it('maps Oasis MCP media tools to first-class labels', () => {
    const tool = describeCodexTool({
      type: 'mcp_tool_call',
      serverName: 'oasis',
      toolName: 'generate_image',
    })

    expect(tool.name).toBe('Generate Image')
    expect(tool.icon).toBe('🎨')
    expect(tool.display).toBe('oasis.generate_image')
  })

  it('humanizes unknown MCP tools cleanly', () => {
    const tool = describeCodexTool({
      type: 'mcp_tool_call',
      serverName: 'oasis',
      toolName: 'create_object',
    })

    expect(tool.name).toBe('Create Object')
    expect(tool.icon).toBe('🧩')
    expect(tool.display).toBe('oasis.create_object')
  })

  it('humanizes raw item types into title case', () => {
    expect(humanizeCodexItemType('plan_update')).toBe('Plan Update')
    expect(humanizeCodexItemType('web-search')).toBe('Web Search')
  })
})
