import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Anorak Pro embodiment + Telegram wiring', () => {
  it('routes audio media through the embodied avatar lip-sync target', () => {
    const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
    const src = fs.readFileSync(panelPath, 'utf-8')

    expect(src).toContain("audioTargetAvatarId={anorakProAvatar?.id || null}")
    expect(src).toContain("avatarLipSyncTargetId={e.mediaType === 'audio' ? audioTargetAvatarId : undefined}")
    expect(src).toContain('shouldAutoPlayFreshAudio')
  })

  it('heartbeat route includes Telegram delivery plumbing', () => {
    const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/heartbeat/route.ts')
    const src = fs.readFileSync(routePath, 'utf-8')

    expect(src).toContain('sendHeartbeatTelegramSummary')
    expect(src).toContain('resolveAnorakProTelegramConfig')
    expect(src).toContain('sendTelegramMessage')
  })

  it('Telegram route supports config, webhook handling, and mission creation', () => {
    const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/telegram/route.ts')
    const src = fs.readFileSync(routePath, 'utf-8')
    const helperPath = path.resolve(__dirname, '../anorak-pro-telegram.ts')
    const helperSrc = fs.readFileSync(helperPath, 'utf-8')

    expect(src).toContain('export async function GET')
    expect(src).toContain('export async function PUT')
    expect(src).toContain('export async function POST')
    expect(src).toContain('processTelegramUpdate')
    expect(src).toContain("action === 'poll-now'")
    expect(helperSrc).toContain('createMissionFromTelegram')
    expect(helperSrc).toContain('buildStatusMessage')
  })

  it('Roadmap World route and panel button are wired in', () => {
    const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/roadmap-world/route.ts')
    const routeSrc = fs.readFileSync(routePath, 'utf-8')
    const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
    const panelSrc = fs.readFileSync(panelPath, 'utf-8')

    expect(routeSrc).toContain('ROADMAP_WORLD_NAME')
    expect(routeSrc).toContain('buildRoadmapScene')
    expect(panelSrc).toContain('/api/anorak/pro/roadmap-world')
    expect(panelSrc).toContain('Open Roadmap World')
  })
})
