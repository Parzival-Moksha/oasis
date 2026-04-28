import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf-8')
}

describe('token accounting wiring', () => {
  it('claude-code route normalizes Claude usage and persists it once', () => {
    const source = readSource('app/api/claude-code/route.ts')
    expect(source).toContain('extractClaudeTokenUsage')
    expect(source).toContain('recordTokenBurn({')
    expect(source).toContain('source: usageSource')
  })

  it('merlin route emits usage events and persists token burn', () => {
    const source = readSource('app/api/merlin/route.ts')
    expect(source).toContain("sendEvent('usage'")
    expect(source).toContain("source: 'merlin'")
    expect(source).toContain('recordTokenBurn({')
  })

  it('codex route tracks cached input tokens exactly', () => {
    const source = readSource('app/api/codex/route.ts')
    expect(source).toContain('extractCodexTokenUsage')
    expect(source).toContain('cachedInputTokens')
    expect(source).toContain("source: 'codex'")
  })

  it('anorak pro routes persist per-lobe token burn records', () => {
    const curateSource = readSource('app/api/anorak/pro/curate/route.ts')
    const heartbeatSource = readSource('app/api/anorak/pro/heartbeat/route.ts')
    const executeSource = readSource('app/api/anorak/pro/execute/route.ts')

    expect(curateSource).toContain("source: 'anorak-pro-curator'")
    expect(heartbeatSource).toContain("source: 'anorak-pro-heartbeat'")
    expect(executeSource).toContain("usageSource?: string")
    expect(executeSource).toContain("'anorak-pro-coder'")
    expect(executeSource).toContain("'anorak-pro-reviewer'")
    expect(executeSource).toContain("'anorak-pro-tester'")
    expect(executeSource).toContain("'anorak-pro-gamer'")
    expect(executeSource).toContain("'anorak-pro-recap'")
  })

  it('token-burn route reads normalized payloads and summary rows', () => {
    const source = readSource('app/api/token-burn/route.ts')
    expect(source).toContain('readTokenUsagePayload')
    expect(source).toContain('recordTokenBurn')
    expect(source).toContain('readTokenBurnSummary')
  })

  it('Anorak panels consume standardized token usage in the browser', () => {
    const anorakContent = readSource('components/forge/AnorakContent.tsx')
    const anorakProPanel = readSource('components/forge/AnorakProPanel.tsx')

    expect(anorakContent).not.toContain("recordTokenUsage('anorak'")
    expect(anorakProPanel).toContain('readTokenUsagePayload')
    expect(anorakProPanel).toContain('summarizeUsageTokens')
  })

  it('Merlin panel and profile button use the new token payload shape', () => {
    const merlinPanel = readSource('components/forge/MerlinPanel.tsx')
    const profileButton = readSource('components/forge/ProfileButton.tsx')

    expect(merlinPanel).toContain("interface MerlinUsageEvent extends TokenUsagePayload")
    expect(merlinPanel).toContain("case 'usage'")
    expect(profileButton).toContain('getProfileDisplayInputTokens(data.grand)')
    expect(profileButton).toContain('formatProfileTokenCost(data)')
  })

  it('Prisma token storage includes provider, session, cached input, and cost fields', () => {
    const schema = readSource('../prisma/schema.prisma')
    expect(schema).toContain('provider          String')
    expect(schema).toContain('model             String')
    expect(schema).toContain('sessionId         String')
    expect(schema).toContain('cachedInputTokens Int')
    expect(schema).toContain('costUsd           Float?')
  })
})
