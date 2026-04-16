import { describe, expect, it } from 'vitest'

import {
  collapseConsecutiveHermesAssistantTurns,
  collapseDuplicateHermesMessages,
  mergeHermesTextBlocks,
  mergeHydratedHermesMessages,
  shouldPreferHydratedHermesMessages,
  type HermesChatMessageLike,
} from '../hermes-message-merge'

function makeMessage(overrides: Partial<HermesChatMessageLike>): HermesChatMessageLike {
  return {
    id: overrides.id || 'm1',
    role: overrides.role || 'assistant',
    content: overrides.content || '',
    reasoning: overrides.reasoning,
    tools: overrides.tools,
    usage: overrides.usage,
    finishReason: overrides.finishReason,
    error: overrides.error,
    timestamp: overrides.timestamp || 1,
  }
}

describe('mergeHermesTextBlocks', () => {
  it('keeps cached streaming detail and appends persisted media lines', () => {
    const result = mergeHermesTextBlocks(
      'tool chatter\nstatus polling needs a tweak',
      'status polling needs a tweak\nMEDIA:/home/art3mis/.hermes/audio_cache/test.mp3'
    )

    expect(result).toContain('tool chatter')
    expect(result).toContain('MEDIA:/home/art3mis/.hermes/audio_cache/test.mp3')
  })

  it('prefers the fuller block when one contains the other', () => {
    expect(mergeHermesTextBlocks('hello', 'hello there')).toBe('hello there')
    expect(mergeHermesTextBlocks('hello there', 'hello')).toBe('hello there')
  })
})

describe('mergeHydratedHermesMessages', () => {
  it('preserves cached tools and reasoning when hydrated data is thinner', () => {
    const hydrated = [
      makeMessage({ id: 'remote-user', role: 'user', content: 'hi', timestamp: 10 }),
      makeMessage({ id: 'remote-assistant', content: 'final answer', timestamp: 20 }),
    ]
    const cached = [
      makeMessage({ id: 'local-user', role: 'user', content: 'hi', timestamp: 10 }),
      makeMessage({
        id: 'local-assistant',
        content: 'tool chatter\nfinal answer',
        reasoning: 'thinking...',
        tools: [{ index: 0, name: 'generate_image', arguments: '{"prompt":"oasis"}' }],
        timestamp: 20,
      }),
    ]

    const result = mergeHydratedHermesMessages(hydrated, cached)

    expect(result[1]?.id).toBe('local-assistant')
    expect(result[1]?.content).toContain('tool chatter')
    expect(result[1]?.reasoning).toContain('thinking...')
    expect(result[1]?.tools?.[0]?.name).toBe('generate_image')
  })

  it('keeps cached tail messages when the remote DB lags behind', () => {
    const hydrated = [
      makeMessage({ id: 'remote-user', role: 'user', content: 'hi', timestamp: 10 }),
    ]
    const cached = [
      makeMessage({ id: 'local-user', role: 'user', content: 'hi', timestamp: 10 }),
      makeMessage({ id: 'local-assistant', content: 'MEDIA:/tmp/note.mp3', timestamp: 20 }),
    ]

    const result = mergeHydratedHermesMessages(hydrated, cached)

    expect(result).toHaveLength(2)
    expect(result[1]?.content).toContain('MEDIA:/tmp/note.mp3')
  })

  it('collapses a tool-call row plus final row into one rich assistant turn', () => {
    const hydrated = [
      makeMessage({ id: 'remote-user', role: 'user', content: 'who are you?', timestamp: 10 }),
      makeMessage({
        id: 'remote-assistant-tool',
        content: "Hey Levi! I'm Art3mis.",
        finishReason: 'tool_calls',
        timestamp: 20,
      }),
      makeMessage({
        id: 'remote-assistant-final',
        content: 'Yeah, I remember.',
        finishReason: 'stop',
        timestamp: 21,
      }),
    ]
    const cached = [
      makeMessage({ id: 'local-user', role: 'user', content: 'who are you?', timestamp: 10 }),
      makeMessage({
        id: 'local-assistant',
        content: "Hey Levi! I'm Art3mis.\nYeah, I remember.",
        reasoning: 'memory lookup',
        tools: [{ index: 0, name: 'mcp_session_search', arguments: '{}' }],
        finishReason: 'stop',
        timestamp: 21,
      }),
    ]

    const result = mergeHydratedHermesMessages(hydrated, cached)
    const assistantMessages = result.filter(message => message.role === 'assistant')

    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.content).toContain("Hey Levi! I'm Art3mis.")
    expect(assistantMessages[0]?.content).toContain('Yeah, I remember.')
    expect(assistantMessages[0]?.finishReason).toBe('stop')
    expect(assistantMessages[0]?.tools?.[0]?.name).toBe('mcp_session_search')
  })
})

describe('collapseDuplicateHermesMessages', () => {
  it('collapses adjacent duplicate assistant rows from session hydration', () => {
    const result = collapseDuplicateHermesMessages([
      makeMessage({ id: 'a1', content: 'same answer', reasoning: 'same thought', timestamp: 20 }),
      makeMessage({ id: 'a2', content: 'same answer', reasoning: 'same thought', timestamp: 21 }),
      makeMessage({ id: 'a3', content: 'same answer', reasoning: 'same thought', timestamp: 22 }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe('same answer')
    expect(result[0]?.reasoning).toBe('same thought')
  })

  it('collapses adjacent assistant rows when one is a subset of the richer streamed turn', () => {
    const result = collapseDuplicateHermesMessages([
      makeMessage({
        id: 'a1',
        content: "Hey Levi! I'm Art3mis.\nYeah, I remember.",
        tools: [{ index: 0, name: 'mcp_session_search', arguments: '{}' }],
        finishReason: 'tool_calls',
        timestamp: 20,
      }),
      makeMessage({
        id: 'a2',
        content: 'Yeah, I remember.',
        finishReason: 'stop',
        timestamp: 21,
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.content).toContain("Hey Levi! I'm Art3mis.")
    expect(result[0]?.content).toContain('Yeah, I remember.')
    expect(result[0]?.finishReason).toBe('stop')
    expect(result[0]?.tools?.[0]?.name).toBe('mcp_session_search')
  })
})

describe('collapseConsecutiveHermesAssistantTurns', () => {
  it('folds raw native assistant rows into a single conversational turn', () => {
    const result = collapseConsecutiveHermesAssistantTurns([
      makeMessage({ id: 'u1', role: 'user', content: 'show me screenshots', timestamp: 10 }),
      makeMessage({
        id: 'a1',
        content: 'Working on it.',
        tools: [{ index: 0, name: 'mcp_oasis_screenshot_viewport', arguments: '{"mode":"player"}' }],
        finishReason: 'tool_calls',
        timestamp: 20,
      }),
      makeMessage({
        id: 'a2',
        content: '',
        tools: [{ index: 1, name: 'mcp_oasis_screenshot_avatar', arguments: '{"subject":"player"}' }],
        finishReason: 'tool_calls',
        timestamp: 21,
      }),
      makeMessage({
        id: 'a3',
        content: 'Done.',
        finishReason: 'stop',
        timestamp: 22,
      }),
    ])

    expect(result).toHaveLength(2)
    expect(result[1]?.role).toBe('assistant')
    expect(result[1]?.content).toContain('Working on it.')
    expect(result[1]?.content).toContain('Done.')
    expect(result[1]?.tools).toHaveLength(2)
    expect(result[1]?.finishReason).toBe('stop')
  })
})

describe('shouldPreferHydratedHermesMessages', () => {
  it('prefers hydrated native rows when they preserve multiple assistant turns and tool metadata', () => {
    const hydrated = [
      makeMessage({ id: 'u1', role: 'user', content: 'watchtower', timestamp: 10 }),
      makeMessage({
        id: 'a1',
        content: 'Crafting tower...',
        tools: [{ index: 0, name: 'mcp_oasis_craft_scene', arguments: '{}' }],
        finishReason: 'tool_calls',
        timestamp: 20,
      }),
      makeMessage({
        id: 'a2',
        content: 'Done.',
        finishReason: 'stop',
        timestamp: 21,
      }),
    ]

    const cached = [
      makeMessage({ id: 'u-local', role: 'user', content: 'watchtower', timestamp: 10 }),
      makeMessage({
        id: 'a-local',
        content: 'Crafting tower...\nDone.\nDone.',
        finishReason: 'stop',
        timestamp: 21,
      }),
    ]

    expect(shouldPreferHydratedHermesMessages(hydrated, cached)).toBe(true)
  })

  it('keeps cached messages when hydrated data is clearly thinner', () => {
    const hydrated = [
      makeMessage({ id: 'u1', role: 'user', content: 'hello', timestamp: 10 }),
    ]
    const cached = [
      makeMessage({ id: 'u-local', role: 'user', content: 'hello', timestamp: 10 }),
      makeMessage({
        id: 'a-local',
        content: 'hello there',
        tools: [{ index: 0, name: 'generate_voice', arguments: '{}' }],
        finishReason: 'stop',
        timestamp: 20,
      }),
    ]

    expect(shouldPreferHydratedHermesMessages(hydrated, cached)).toBe(false)
  })

  it('keeps cached messages when hydrated native rows lose user turns', () => {
    const hydrated = [
      makeMessage({ id: 'u1', role: 'user', content: 'first prompt', timestamp: 10 }),
      makeMessage({
        id: 'a1',
        content: 'latest response',
        tools: [{ index: 0, name: 'mcp_oasis_walk_avatar_to', arguments: '{}' }],
        finishReason: 'stop',
        timestamp: 20,
      }),
    ]

    const cached = [
      makeMessage({ id: 'u-local-1', role: 'user', content: 'first prompt', timestamp: 10 }),
      makeMessage({ id: 'a-local-1', content: 'first response', finishReason: 'stop', timestamp: 11 }),
      makeMessage({ id: 'u-local-2', role: 'user', content: 'second prompt', timestamp: 12 }),
      makeMessage({ id: 'a-local-2', content: 'latest response', finishReason: 'stop', timestamp: 20 }),
    ]

    expect(shouldPreferHydratedHermesMessages(hydrated, cached)).toBe(false)
  })

  it('prefers hydrated messages when cached content is duplicated noise', () => {
    const hydrated = [
      makeMessage({ id: 'u1', role: 'user', content: 'voice note', timestamp: 10 }),
      makeMessage({
        id: 'a1',
        content: 'MEDIA:/tmp/hermes-audio.mp3',
        finishReason: 'stop',
        timestamp: 20,
      }),
    ]

    const cached = [
      makeMessage({ id: 'u-local', role: 'user', content: 'voice note', timestamp: 10 }),
      makeMessage({
        id: 'a-local',
        content: 'MEDIA:/tmp/hermes-audio.mp3\nMEDIA:/tmp/hermes-audio.mp3',
        finishReason: 'stop',
        timestamp: 20,
      }),
    ]

    expect(shouldPreferHydratedHermesMessages(hydrated, cached)).toBe(true)
  })
})
