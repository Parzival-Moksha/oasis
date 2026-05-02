import { describe, expect, it } from 'vitest'

import {
  RELAY_FRAME_MAX_BYTES,
  RelayProtocolError,
  buildRelayMessage,
  parseRelayMessage,
  safeParseRelayMessage,
} from '../protocol'

// Characterization tests for the relay wire protocol. These lock the contract
// before the hosted relay + pairing surface lands on top. Drift here breaks
// three independent processes (browser hook, dev sidecar, OpenClaw bridge),
// so the schema deserves a regression net.

describe('buildRelayMessage', () => {
  it('stamps messageId and sentAt when omitted', () => {
    const before = Date.now()
    const built = buildRelayMessage({
      type: 'browser.hello',
      browserSessionId: 'bs-123',
      worldId: 'world-1',
      roomId: 'room-1',
    })
    const after = Date.now()

    expect(built.type).toBe('browser.hello')
    expect(built.messageId).toMatch(/^m_/)
    expect(built.sentAt).toBeGreaterThanOrEqual(before)
    expect(built.sentAt).toBeLessThanOrEqual(after)
  })

  it('respects caller-provided messageId and sentAt', () => {
    const built = buildRelayMessage({
      type: 'tool.call',
      callId: 'call-1',
      toolName: 'get_world_info',
      args: {},
      scope: 'world.read',
      messageId: 'm_explicit',
      sentAt: 1700000000,
    })
    expect(built.messageId).toBe('m_explicit')
    expect(built.sentAt).toBe(1700000000)
  })

  it('regenerates defaults when caller passes explicit undefined (regression: spread order)', () => {
    // Reviewer flagged: caller-side `messageId: undefined` from Omit-based input
    // types must NOT clobber the generated id. Verifies the spread fix.
    const built = buildRelayMessage({
      type: 'chat.user',
      sessionId: 'sess-1',
      text: 'hi',
      messageId: undefined,
      sentAt: undefined,
    })
    expect(built.messageId).toMatch(/^m_/)
    expect(typeof built.sentAt).toBe('number')
    expect(built.sentAt).toBeGreaterThan(0)
  })

  it('rejects construction of an envelope that fails schema', () => {
    expect(() => buildRelayMessage({
      type: 'browser.hello',
      browserSessionId: '',
      worldId: 'w',
      roomId: 'r',
    } as Parameters<typeof buildRelayMessage>[0]))
      .toThrowError(RelayProtocolError)
  })
})

describe('parseRelayMessage — happy paths', () => {
  it('round-trips through JSON without loss', () => {
    const built = buildRelayMessage({
      type: 'tool.result',
      callId: 'call-1',
      ok: true,
      data: { worldName: 'demo', objectCount: 3 },
    })
    const json = JSON.parse(JSON.stringify(built))
    const parsed = parseRelayMessage(json)
    expect(parsed).toEqual(built)
  })

  it('accepts agent.hello with pairingCode only', () => {
    const result = safeParseRelayMessage({
      type: 'agent.hello',
      messageId: 'm_1',
      sentAt: 1,
      pairingCode: 'OASIS-K7M2',
      agentLabel: 'fake-bridge',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts agent.hello with deviceToken only', () => {
    const result = safeParseRelayMessage({
      type: 'agent.hello',
      messageId: 'm_1',
      sentAt: 1,
      deviceToken: 'dev_eyJhb...',
      agentLabel: 'openclaw-bridge',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts presence.update with optional vec3 fields', () => {
    const built = buildRelayMessage({
      type: 'presence.update',
      actorId: 'actor-1',
      kind: 'agent',
      position: [1, 2, 3],
    })
    expect(built.type).toBe('presence.update')
  })

  it('accepts hosted session sync responses with cached history', () => {
    const built = buildRelayMessage({
      type: 'session.sync.response',
      selectedSessionId: 'agent:main:main',
      sessions: [{
        id: 'agent:main:main',
        title: 'Main',
        preview: 'hello',
        source: 'gateway',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 2,
      }],
      messagesBySessionId: {
        'agent:main:main': [
          { id: 'm1', role: 'user', content: 'hello', timestamp: 1, state: 'done' },
        ],
      },
    })
    expect(built.type).toBe('session.sync.response')
    if (built.type !== 'session.sync.response') throw new Error('unexpected message type')
    expect(built.sessions[0].id).toBe('agent:main:main')
  })
})

describe('parseRelayMessage — rejection paths', () => {
  it('rejects unknown message type', () => {
    expect(() => parseRelayMessage({
      type: 'unknown.thing',
      messageId: 'm_1',
      sentAt: 1,
    })).toThrowError(RelayProtocolError)
  })

  it('rejects unknown fields on a known type (strict)', () => {
    expect(() => parseRelayMessage({
      type: 'browser.hello',
      messageId: 'm_1',
      sentAt: 1,
      browserSessionId: 'bs',
      worldId: 'w',
      roomId: 'r',
      surpriseField: 'should not be here',
    })).toThrowError(RelayProtocolError)
  })

  it('rejects agent.hello missing both pairingCode and deviceToken', () => {
    const result = safeParseRelayMessage({
      type: 'agent.hello',
      messageId: 'm_1',
      sentAt: 1,
      agentLabel: 'bridge',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('agent_hello_missing_credential')
    }
  })

  it('rejects oversized chat text', () => {
    const result = safeParseRelayMessage({
      type: 'chat.user',
      messageId: 'm_1',
      sentAt: 1,
      sessionId: 's',
      text: 'a'.repeat(20_000),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects tool.call with invalid scope', () => {
    expect(() => parseRelayMessage({
      type: 'tool.call',
      messageId: 'm_1',
      sentAt: 1,
      callId: 'c1',
      toolName: 'get_world_info',
      args: {},
      scope: 'world.write.unsafe',
    })).toThrowError(RelayProtocolError)
  })

  it('rejects empty required string fields', () => {
    expect(() => parseRelayMessage({
      type: 'tool.result',
      messageId: 'm_1',
      sentAt: 1,
      callId: '',
      ok: true,
    })).toThrowError(RelayProtocolError)
  })

  it('rejects negative sentAt', () => {
    expect(() => parseRelayMessage({
      type: 'browser.hello',
      messageId: 'm_1',
      sentAt: -1,
      browserSessionId: 'bs',
      worldId: 'w',
      roomId: 'r',
    })).toThrowError(RelayProtocolError)
  })

  it('rejects entirely non-object input', () => {
    expect(() => parseRelayMessage('not a message')).toThrowError(RelayProtocolError)
    expect(() => parseRelayMessage(null)).toThrowError(RelayProtocolError)
    expect(() => parseRelayMessage(42)).toThrowError(RelayProtocolError)
  })
})

describe('safeParseRelayMessage', () => {
  it('returns ok:false with a RelayProtocolError on bad input', () => {
    const result = safeParseRelayMessage({ type: 'no.such.thing' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RelayProtocolError)
    }
  })

  it('returns ok:true with the parsed message on good input', () => {
    const built = buildRelayMessage({
      type: 'error',
      code: 'unauthorized',
      message: 'no token',
    })
    const result = safeParseRelayMessage(built)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.msg.type).toBe('error')
    }
  })
})

describe('protocol limits', () => {
  it('exposes RELAY_FRAME_MAX_BYTES at 8 MiB', () => {
    expect(RELAY_FRAME_MAX_BYTES).toBe(8 * 1024 * 1024)
  })
})
