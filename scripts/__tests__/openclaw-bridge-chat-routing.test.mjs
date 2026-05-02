import { describe, expect, it } from 'vitest'

import { createGatewayChatRouter } from '../openclaw-bridge-chat-routing.mjs'

function createHarness() {
  const sent = []
  const logs = []
  const router = createGatewayChatRouter({
    sendRelay: (message) => {
      sent.push(message)
      return true
    },
    log: (...args) => logs.push(args),
  })
  return { router, sent, logs }
}

describe('OpenClaw bridge chat routing', () => {
  it('routes a Gateway final event that arrives before chat.send resolves when sessionKey is present', () => {
    const { router, sent } = createHarness()

    router.beginChat({
      sessionId: 'hosted-session-a',
      sessionKey: 'hosted-session-a',
      idempotencyKey: 'idem-a',
    })
    router.handleGatewayChatPayload({
      runId: 'run-a',
      sessionKey: 'hosted-session-a',
      state: 'final',
      message: 'answer before send returned',
    })
    router.attachRunId({
      runId: 'run-a',
      sessionId: 'hosted-session-a',
      sessionKey: 'hosted-session-a',
      idempotencyKey: 'idem-a',
    })

    expect(sent).toEqual([{
      type: 'chat.agent.final',
      sessionId: 'hosted-session-a',
      text: 'answer before send returned',
    }])
  })

  it('buffers an early Gateway final by runId and flushes it when chat.send returns', () => {
    const { router, sent } = createHarness()

    router.beginChat({
      sessionId: 'hosted-session-b',
      sessionKey: 'hosted-session-b',
      idempotencyKey: 'idem-b',
    })
    router.handleGatewayChatPayload({
      runId: 'run-b',
      state: 'final',
      message: 'buffered answer',
    })
    expect(sent).toEqual([])

    router.attachRunId({
      runId: 'run-b',
      sessionId: 'hosted-session-b',
      sessionKey: 'hosted-session-b',
      idempotencyKey: 'idem-b',
    })

    expect(sent).toEqual([{
      type: 'chat.agent.final',
      sessionId: 'hosted-session-b',
      text: 'buffered answer',
    }])
  })

  it('routes delta and final events by mapped runId', () => {
    const { router, sent } = createHarness()

    router.beginChat({
      sessionId: 'hosted-session-c',
      sessionKey: 'hosted-session-c',
      idempotencyKey: 'idem-c',
    })
    router.attachRunId({
      runId: 'run-c',
      sessionId: 'hosted-session-c',
      sessionKey: 'hosted-session-c',
      idempotencyKey: 'idem-c',
    })
    router.handleGatewayChatPayload({ runId: 'run-c', state: 'delta', delta: 'hel' })
    router.handleGatewayChatPayload({ runId: 'run-c', state: 'final', message: 'hello' })

    expect(sent).toEqual([
      { type: 'chat.agent.delta', sessionId: 'hosted-session-c', text: 'hel' },
      { type: 'chat.agent.final', sessionId: 'hosted-session-c', text: 'hello' },
    ])
  })
})
