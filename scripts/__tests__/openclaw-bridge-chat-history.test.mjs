import { describe, expect, it } from 'vitest'

import {
  extractAssistantReplyFromHistory,
  extractTextFromGatewayContent,
} from '../openclaw-bridge-chat-history.mjs'

describe('OpenClaw bridge chat history fallback', () => {
  it('extracts the assistant answer after the matching user message', () => {
    const startedAtMs = Date.parse('2026-05-02T12:00:00.000Z')
    const reply = extractAssistantReplyFromHistory({
      messages: [
        { role: 'user', content: 'old prompt', timestamp: '2026-05-02T11:59:00.000Z' },
        { role: 'assistant', content: 'old answer', timestamp: '2026-05-02T11:59:01.000Z' },
        { role: 'user', content: 'say ROUTING_CHAT_OK', timestamp: '2026-05-02T12:00:01.000Z' },
        { role: 'assistant', content: 'ROUTING_CHAT_OK', timestamp: '2026-05-02T12:00:02.000Z' },
      ],
    }, {
      userMessage: 'say ROUTING_CHAT_OK',
      startedAtMs,
    })

    expect(reply).toBe('ROUTING_CHAT_OK')
  })

  it('handles gateway message wrappers and structured text blocks', () => {
    const reply = extractAssistantReplyFromHistory({
      messages: [
        {
          type: 'message',
          timestamp: 1000,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'gm' }],
          },
        },
        {
          type: 'message',
          timestamp: 2000,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'gm from history' }],
          },
        },
      ],
    }, {
      userMessage: 'gm',
      startedAtMs: 500,
    })

    expect(reply).toBe('gm from history')
  })

  it('strips sender metadata from history text', () => {
    expect(extractTextFromGatewayContent('Sender (untrusted metadata): ```json\n{}\n```\nhello')).toBe('hello')
  })
})
