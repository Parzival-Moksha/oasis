import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Anorak Pro chat identity wiring', () => {
  it('AnorakProPanel sends chat turns with the anorak-pro agent flag', () => {
    const filePath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain("agent: 'anorak-pro'")
    expect(content).toContain("const PRO_SESSION_KEY = 'oasis-anorak-pro-session-v2'")
    expect(content).toContain("/api/anorak/pro/config")
  })

  it('claude-code route supports anorak-pro agent mode with Anorak context modules', () => {
    const filePath = path.resolve(__dirname, '../../app/api/claude-code/route.ts')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain("body.agent === 'anorak-pro'")
    expect(content).toContain("'--agent', selectedAgent")
    expect(content).toContain("buildAnorakProConversationPrompt")
    expect(content).toContain("lobe: 'anorak-pro'")
    expect(content).toContain('Refresh yourself with the live context below before answering.')
  })
})
