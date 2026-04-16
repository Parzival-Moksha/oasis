import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Anorak Pro Telegram polling bridge', () => {
  const routePath = path.resolve(__dirname, '../../app/api/anorak/pro/telegram/route.ts')
  const helperPath = path.resolve(__dirname, '../anorak-pro-telegram.ts')
  const telegramLibPath = path.resolve(__dirname, '../telegram.ts')
  const panelPath = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')

  it('telegram route exposes poll-now and restart-polling actions', () => {
    const source = fs.readFileSync(routePath, 'utf-8')

    expect(source).toContain("action === 'poll-now'")
    expect(source).toContain("action === 'restart-polling'")
    expect(source).toContain('ensureAnorakProTelegramPolling')
  })

  it('route persists polling and Telegram voice settings', () => {
    const source = fs.readFileSync(routePath, 'utf-8')

    expect(source).toContain('pollingEnabled')
    expect(source).toContain('pollingIntervalSec')
    expect(source).toContain('voiceNotesEnabled')
    expect(source).toContain('voiceRepliesEnabled')
  })

  it('helper routes plain Telegram chat into the real Anorak Pro conversation path', () => {
    const source = fs.readFileSync(helperPath, 'utf-8')

    expect(source).toContain("fetch(`${origin}/api/claude-code`")
    expect(source).toContain("agent: 'anorak-pro'")
    expect(source).toContain('runAnorakProTelegramConversation')
    expect(source).toContain('readStoredAnorakProContextConfig')
    expect(source).toContain('/new - reset only the Claude session for this Telegram chat')
  })

  it('helper transcribes Telegram voice notes with the local STT pipeline', () => {
    const source = fs.readFileSync(helperPath, 'utf-8')

    expect(source).toContain('downloadTelegramFile')
    expect(source).toContain('transcribeLocally')
    expect(source).toContain('Voice notes are currently disabled')
    expect(source).toContain('Plain text gets a written reply plus a short spoken TLDR by default.')
  })

  it('telegram lib implements getUpdates polling and file download helpers', () => {
    const source = fs.readFileSync(telegramLibPath, 'utf-8')

    expect(source).toContain('getTelegramUpdates')
    expect(source).toContain('downloadTelegramFile')
    expect(source).toContain('sendTelegramChatAction')
    expect(source).toContain('sendTelegramAudio')
    expect(source).toContain('sendTelegramPhoto')
    expect(source).toContain("typeof value === 'number'")
  })

  it('panel exposes polling controls and Telegram voice settings', () => {
    const source = fs.readFileSync(panelPath, 'utf-8')

    expect(source).toContain('2-way local polling')
    expect(source).toContain('pollTelegramNow')
    expect(source).toContain("voiceNotesEnabled")
    expect(source).toContain("voiceRepliesEnabled")
  })

  it('helper accepts numeric Telegram IDs from getUpdates payloads', () => {
    const source = fs.readFileSync(helperPath, 'utf-8')

    expect(source).toContain("typeof value === 'number'")
    expect(source).toContain('unexpected-chat')
  })

  it('helper uploads generated images back into Telegram replies', () => {
    const source = fs.readFileSync(helperPath, 'utf-8')

    expect(source).toContain('sendTelegramConversationImages')
    expect(source).toContain("media => media.mediaType === 'image'")
    expect(source).toContain('sendTelegramPhoto')
  })
})
